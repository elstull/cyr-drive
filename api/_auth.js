// api/_auth.js
// Shared auth verification for API routes.
//
// Verifies the caller's Supabase access token (Authorization: Bearer <jwt>),
// resolves the fsm_users.id slug linked to that auth user via auth_id, and
// confirms that the slug matches the body's userId claim. Rejects with 401
// for missing/invalid tokens and 403 for mismatches (including no fsm_users
// row for the auth user). Any other unexpected failure returns 500.
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
    if (!bodyUserId) {
      res.status(403).json({ error: 'User mismatch' });
      return null;
    }
    // Resolve the fsm_users.id slug (e.g. "ed.stull") for the JWT's auth
    // user UUID. The client sends the slug in req.body.userId; compare that
    // against the slug we just resolved from the verified token.
    const { data: fsmUser, error: fsmError } = await supabase
      .from('fsm_users')
      .select('id')
      .eq('auth_id', data.user.id)
      .single();
    if (fsmError || !fsmUser?.id || fsmUser.id !== bodyUserId) {
      res.status(403).json({ error: 'User mismatch' });
      return null;
    }
    return { user: data.user, userId: fsmUser.id };
  } catch {
    res.status(500).json({ error: 'Auth check failed' });
    return null;
  }
}
