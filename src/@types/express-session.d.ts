import session from 'express-session';

declare module 'express-session' {
  interface SessionData {
    userId: string; // Add any properties you are storing in session
    // Add other properties if needed
  }
}

declare module 'express' {
  interface Request {
    session: session.Session & Partial<session.SessionData>;
  }
}
