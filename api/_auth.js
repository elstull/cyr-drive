// api/_auth.js
// Shared auth verification for API routes.
//
// Verifies the caller's Supabase access token (Authorization: Bearer <jwt>)
// and confirms that the user.id resolved from the token matches the body's
// userId claim. Rejects with 401 for missing/invalid tokens and 403 for
// mismatches. Any other unexpected failure returns 500.
//
// Files in api/ whose name begins with `_` are NOT deployed as Vercel
// serverless functions; they can only be imported by peer files in api/.
//
// Usage:
//   const auth = await verifyAuth(req, res, supabase);
//   if (!auth) return;
//   const { user, userId } = auth;

export async function verifyAuth(req, res, supabase) {
  try {
    const header = req.headers.authorization || '';
    if (!header || !header.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Unauthenticated' });
      return null;
    }
    const token = header.slice('Bearer '.length).trim();
    if (!token) {
      res.status(401).json({ error: 'Unauthenticated' });
      return null;
    }
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) {
      res.status(401).json({ error: 'Invalid session' });
      return null;
    }
    const bodyUserId = req.body?.userId;
    if (!bodyUserId || data.user.id !== bodyUserId) {
      res.status(403).json({ error: 'User mismatch' });
      return null;
    }
    return { user: data.user, userId: data.user.id };
  } catch {
    res.status(500).json({ error: 'Auth check failed' });
    return null;
  }
}
