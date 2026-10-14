import { ApiError, requireValue } from '../errors/api-error.js';
import { isPlainObject } from '../validators/sync.validator.js';
export type JsonValue = null | string | number | boolean | JsonValue[] | { [key: string]: JsonValue };
export type FirestoreValue =
  | { nullValue: null }
  | { stringValue: string }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number }
  | { timestampValue: string }
  | { arrayValue: { values?: FirestoreValue[] } }
  | { mapValue: { fields?: Record<string, FirestoreValue> } };

export function encodeValue(value: unknown, depth = 0): FirestoreValue {
  requireValue(depth <= 20, 'Dữ liệu lồng quá sâu.');
  if (value === null) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number' && Number.isFinite(value)) return Number.isSafeInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(item => encodeValue(item, depth + 1)) } };
  requireValue(isPlainObject(value), 'Dữ liệu JSON không hợp lệ.');
  return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encodeValue(item, depth + 1)])) } };
}

export function decodeValue(value: FirestoreValue): JsonValue {
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('nullValue' in value) return null;
  if ('timestampValue' in value) return value.timestampValue;
  if ('arrayValue' in value) return (value.arrayValue.values ?? []).map(decodeValue);
  if ('mapValue' in value) return decodeFields(value.mapValue.fields);
  throw new ApiError(502, 'Firestore trả về dữ liệu không hợp lệ.', 'UPSTREAM_INVALID_RESPONSE');
}

export function decodeFields(fields?: Record<string, FirestoreValue>): Record<string, JsonValue> {
  return Object.fromEntries(Object.entries(fields ?? {}).map(([key, value]) => [key, decodeValue(value)]));
}
