// Khởi tạo lười để bài test inject verifier/repository mà không kết nối Firebase.
import type { Auth } from 'firebase-admin/auth';
import type { TokenVerifier } from '../types/http.js';

export function createFirebaseTokenVerifier(project: string): TokenVerifier {
  let loading: Promise<Auth> | undefined;
  return async (token: string) => {
    loading ??= Promise.all([import('firebase-admin/app'), import('firebase-admin/auth')]).then(([appModule, authModule]) => {
      const name = `hanngu-api:${project}`;
      const app = appModule.getApps().find(item => item.name === name) || appModule.initializeApp({ projectId: project }, name);
      return authModule.getAuth(app);
    }).catch(error => { loading = undefined; throw error; });
    return (await loading).verifyIdToken(token);
  };
}
