/** Stand-in for "firebase/app" in the container build: there is no Firebase project to configure. */
export interface FirebaseApp {
  readonly name: string;
}

const apps: FirebaseApp[] = [];

export function initializeApp(_config?: unknown): FirebaseApp {
  const app: FirebaseApp = { name: "[DEFAULT]" };
  apps.push(app);
  return app;
}

export function getApps(): FirebaseApp[] {
  return apps;
}
