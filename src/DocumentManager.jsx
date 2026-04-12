import { useState, useEffect, useRef, useCallback } from 'react';

// ═══════════════════════════════════════════════════════════════════════════
// DOCUMENT MANAGER — Upload, search, manage, supersede
//
// Tab 1 — Upload: Multi-file picker, preview list with checkboxes,
//         select which to keep, assign source/category, upload selected.
// Tab 2 — Manage: Browse all documents with attributes, multi-select,
//         supersede (new doc replaces checked ones), archive, search.
//
// Writes to: documentation table (golden schema with provenance + lifecycle)
// Storage:   documents bucket
//
// Version: 3.0.0 — 2026-04-12
// ═══════════════════════════════════════════════════════════════════════════

const DIM = '#556677';
const BLUE = '#4a90d9';
const GREEN = '#4ade80';
const YELLOW = '#e8c060';
const RED = '#f08080';
const PURPLE = '#a78bfa';

const CATEGORIES = [
  { id: 'invoice', label: 'Invoice' },
  { id: 'contract', label: 'Contract / Agreement' },
  { id: 'report', label: 'Report / Assessment' },
  { id: 'correspondence', label: 'Letter / Email' },
  { id: 'receipt', label: 'Receipt / Proof' },
  { id: 'policy', label: 'Policy / Procedure' },
  { id: 'regulation', label: 'Regulation / Compliance' },
  { id: 'form', label: 'Form / Application' },
  { id: 'note', label: 'Meeting Note / Verbal' },
  { id: 'other', label: 'Other' },
];

const STATUS_COLORS = {
  active: GREEN,
  draft: YELLOW,
  superseded: DIM,
  archived: '#445566',
};

const STATUS_LABELS = {
  active: 'Active',
  draft: 'Draft',
  superseded: 'Superseded',
  archived: 'Archived',
};

function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function formatDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}


export default function DocumentManager({ supabase, currentUser, users, onClose }) {
  const [tab, setTab] = useState('upload'); // 'upload' | 'manage'

  // ── Upload state ──
  const [stagedFiles, setStagedFiles] = useState([]); // { file, name, size, type, selected, category }
  const [sourceName, setSourceName] = useState('');
  const [defaultCategory, setDefaultCategory] = useState('other');
  const [uploading, setUploading] = useState(false);
  const [uploadResults, setUploadResults] = useState(null);
  const fileRef = useRef(null);

  // ── Manage state ──
  const [documents, setDocuments] = useState([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [selectedDocs, setSelectedDocs] = useState(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [showSupersede, setShowSupersede] = useState(false);
  const [supersedeDoc, setSupersedeDoc] = useState(null); // the new doc that supersedes
  const [actionMessage, setActionMessage] = useState(null);

  const userName = users?.[currentUser]?.name || currentUser;

  // ── Load documents ──
  const loadDocuments = useCallback(async () => {
    if (!supabase) return;
    setDocsLoading(true);
    try {
      const { data, error } = await supabase
        .from('documentation')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      setDocuments(data || []);
    } catch (e) {
      console.error('Load docs error:', e);
    }
    setDocsLoading(false);
  }, [supabase]);

  useEffect(() => {
    if (tab === 'manage') loadDocuments();
  }, [tab, loadDocuments]);

  // ── Upload: stage files ──
  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files || []);
    const staged = files.map(f => ({
      file: f,
      name: f.name,
      size: f.size,
      type: f.type,
      selected: true,
      category: defaultCategory,
      title: f.name.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' '),
    }));
    setStagedFiles(prev => [...prev, ...staged]);
    setUploadResults(null);
  };

  const toggleFileSelect = (idx) => {
    setStagedFiles(prev => prev.map((f, i) => i === idx ? { ...f, selected: !f.selected } : f));
  };

  const selectAll = () => setStagedFiles(prev => prev.map(f => ({ ...f, selected: true })));
  const clearAll = () => setStagedFiles(prev => prev.map(f => ({ ...f, selected: false })));
  const removeFile = (idx) => setStagedFiles(prev => prev.filter((_, i) => i !== idx));

  const updateFileField = (idx, field, value) => {
    setStagedFiles(prev => prev.map((f, i) => i === idx ? { ...f, [field]: value } : f));
  };

  const selectedCount = stagedFiles.filter(f => f.selected).length;

  // ── Upload: execute ──
  const handleUpload = async () => {
    const toUpload = stagedFiles.filter(f => f.selected);
    if (!toUpload.length || !supabase) return;
    setUploading(true);
    const results = [];

    for (const staged of toUpload) {
      try {
        const docId = 'DOC-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
        let storagePath = null;

        // Upload file to storage
        const ext = staged.name.split('.').pop() || 'bin';
        storagePath = `${currentUser}/${docId}.${ext}`;
        const { error: uploadErr } = await supabase.storage
          .from('documents')
          .upload(storagePath, staged.file, { contentType: staged.type, upsert: false });
        if (uploadErr) {
          console.error('Storage error:', uploadErr);
          storagePath = null;
        }

        // Insert into documentation
        const { error: insertErr } = await supabase.from('documentation').insert({
          title: staged.title || staged.name,
          content: `[Uploaded file: ${staged.name}]`,
          category: staged.category,
          source_type: 'document',
          source_name: sourceName || userName,
          confidence: 'direct',
          file_type: staged.type,
          file_path: storagePath,
          uploaded_by: currentUser,
          created_by: currentUser,
          status: 'active',
        });

        if (insertErr) throw insertErr;
        results.push({ name: staged.name, success: true, stored: !!storagePath });
      } catch (err) {
        results.push({ name: staged.name, success: false, error: err.message });
      }
    }

    // Log activity
    try {
      const successCount = results.filter(r => r.success).length;
      await supabase.from('activity_log').insert({
        user_id: currentUser,
        user_name: userName,
        action_type: 'bulk_upload',
        title: `Uploaded ${successCount} document${successCount !== 1 ? 's' : ''}`,
        detail: results.map(r => `${r.name}: ${r.success ? 'OK' : r.error}`).join('; ').slice(0, 500),
        entity_type: 'document',
      });
    } catch {}

    setUploadResults(results);
    setUploading(false);
    // Clear successful uploads from staging
    const failedNames = new Set(results.filter(r => !r.success).map(r => r.name));
    setStagedFiles(prev => prev.filter(f => failedNames.has(f.name)));
  };

  // ── Manage: toggle document selection ──
  const toggleDocSelect = (id) => {
    setSelectedDocs(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAllDocs = () => {
    setSelectedDocs(new Set(filteredDocs.map(d => d.id)));
  };

  const clearDocSelection = () => setSelectedDocs(new Set());

  // ── Manage: supersede ──
  const handleSupersede = async () => {
    if (!supersedeDoc || selectedDocs.size === 0 || !supabase) return;
    const idsToSupersede = Array.from(selectedDocs).filter(id => id !== supersedeDoc.id);
    if (!idsToSupersede.length) return;

    try {
      for (const id of idsToSupersede) {
        await supabase.from('documentation')
          .update({ status: 'superseded', superseded_by: supersedeDoc.id, updated_at: new Date().toISOString() })
          .eq('id', id);
      }
      setActionMessage(`${idsToSupersede.length} document${idsToSupersede.length > 1 ? 's' : ''} superseded by "${supersedeDoc.title}"`);
      setShowSupersede(false);
      setSupersedeDoc(null);
      setSelectedDocs(new Set());
      loadDocuments();
    } catch (err) {
      setActionMessage('Error: ' + err.message);
    }
    setTimeout(() => setActionMessage(null), 4000);
  };

  // ── Manage: archive selected ──
  const handleArchive = async () => {
    if (selectedDocs.size === 0 || !supabase) return;
    try {
      for (const id of selectedDocs) {
        await supabase.from('documentation')
          .update({ status: 'archived', updated_at: new Date().toISOString() })
          .eq('id', id);
      }
      setActionMessage(`${selectedDocs.size} document${selectedDocs.size > 1 ? 's' : ''} archived`);
      setSelectedDocs(new Set());
      loadDocuments();
    } catch (err) {
      setActionMessage('Error: ' + err.message);
    }
    setTimeout(() => setActionMessage(null), 4000);
  };

  // ── Manage: restore selected ──
  const handleRestore = async () => {
    if (selectedDocs.size === 0 || !supabase) return;
    try {
      for (const id of selectedDocs) {
        await supabase.from('documentation')
          .update({ status: 'active', superseded_by: null, updated_at: new Date().toISOString() })
          .eq('id', id);
      }
      setActionMessage(`${selectedDocs.size} document${selectedDocs.size > 1 ? 's' : ''} restored to active`);
      setSelectedDocs(new Set());
      loadDocuments();
    } catch (err) {
      setActionMessage('Error: ' + err.message);
    }
    setTimeout(() => setActionMessage(null), 4000);
  };

  // ── Manage: filtered list ──
  const filteredDocs = documents.filter(d => {
    if (filterStatus !== 'all' && d.status !== filterStatus) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (d.title || '').toLowerCase().includes(q)
        || (d.category || '').toLowerCase().includes(q)
        || (d.source_name || '').toLowerCase().includes(q)
        || (d.content || '').toLowerCase().includes(q);
    }
    return true;
  });

  // ═════════════════════════════════════════════
  // RENDER
  // ═════════════════════════════════════════════

  return (
    <div style={{ maxWidth: 600, margin: '0 auto', padding: '16px', color: '#e2e8f0',
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Documents</div>
          <div style={{ fontSize: 12, color: DIM }}>Upload, search, and manage — Chat finds everything</div>
        </div>
        <button onClick={onClose} style={{
          background: 'none', border: 'none', color: '#8899aa', fontSize: 20,
          cursor: 'pointer', fontFamily: 'inherit', padding: '4px 8px',
        }}>{'\u2715'}</button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        <button onClick={() => setTab('upload')} style={{
          flex: 1, padding: '10px', textAlign: 'center', borderRadius: 8,
          background: tab === 'upload' ? '#111827' : 'transparent',
          border: '1px solid ' + (tab === 'upload' ? BLUE : '#1e293b'),
          color: tab === 'upload' ? BLUE : DIM, fontSize: 13, fontWeight: 700,
          cursor: 'pointer', fontFamily: 'inherit',
        }}>{'\uD83D\uDCE4'} Upload</button>
        <button onClick={() => setTab('manage')} style={{
          flex: 1, padding: '10px', textAlign: 'center', borderRadius: 8,
          background: tab === 'manage' ? '#111827' : 'transparent',
          border: '1px solid ' + (tab === 'manage' ? BLUE : '#1e293b'),
          color: tab === 'manage' ? BLUE : DIM, fontSize: 13, fontWeight: 700,
          cursor: 'pointer', fontFamily: 'inherit',
        }}>{'\uD83D\uDCC2'} Manage ({documents.length})</button>
      </div>

      {actionMessage && (
        <div style={{ background: GREEN + '22', border: '1px solid ' + GREEN + '44', borderRadius: 8,
          padding: '10px 14px', marginBottom: 12, fontSize: 13, color: GREEN }}>
          {actionMessage}
        </div>
      )}

      {/* ══════ UPLOAD TAB ══════ */}
      {tab === 'upload' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* File picker */}
          <button onClick={() => fileRef.current?.click()} style={{
            background: '#111827', border: '2px dashed #3a4a5e', borderRadius: 12,
            padding: '30px 20px', textAlign: 'center', cursor: 'pointer',
            color: BLUE, fontSize: 14, fontWeight: 600, fontFamily: 'inherit',
          }}>
            <div style={{ fontSize: 32, marginBottom: 6 }}>{'\uD83D\uDCC1'}</div>
            Choose files to upload
            <div style={{ fontSize: 11, color: DIM, marginTop: 4 }}>PDF, Word, images, spreadsheets, text — select multiple</div>
          </button>
          <input ref={fileRef} type="file" multiple
            accept="image/*,application/pdf,.docx,.xlsx,.csv,.txt,.doc,.xls"
            onChange={handleFileSelect} style={{ display: 'none' }} />

          {/* Source and default category */}
          {stagedFiles.length > 0 && (
            <>
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={sourceName} onChange={e => setSourceName(e.target.value)}
                  placeholder="Source (who provided these?)"
                  style={{ flex: 1, background: '#111827', border: '1px solid #3a4a5e', borderRadius: 8,
                    padding: '8px 12px', color: '#e2e8f0', fontSize: 13, fontFamily: 'inherit', outline: 'none' }} />
                <select value={defaultCategory} onChange={e => setDefaultCategory(e.target.value)}
                  style={{ background: '#111827', border: '1px solid #3a4a5e', borderRadius: 8,
                    padding: '8px 12px', color: '#e2e8f0', fontSize: 12, fontFamily: 'inherit' }}>
                  {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </div>

              {/* Select all / clear */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: DIM }}>{selectedCount} of {stagedFiles.length} selected</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={selectAll} style={{ background: 'none', border: '1px solid #2a3a4e', borderRadius: 6,
                    padding: '4px 10px', color: BLUE, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>Select All</button>
                  <button onClick={clearAll} style={{ background: 'none', border: '1px solid #2a3a4e', borderRadius: 6,
                    padding: '4px 10px', color: DIM, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>Clear</button>
                </div>
              </div>

              {/* File list */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 300, overflowY: 'auto' }}>
                {stagedFiles.map((f, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    background: f.selected ? '#111827' : '#0a0e17',
                    border: '1px solid ' + (f.selected ? BLUE + '44' : '#1e293b'),
                    borderRadius: 8, padding: '8px 10px',
                    opacity: f.selected ? 1 : 0.5,
                  }}>
                    {/* Checkbox */}
                    <div onClick={() => toggleFileSelect(i)} style={{
                      width: 20, height: 20, borderRadius: 4, flexShrink: 0, cursor: 'pointer',
                      border: '2px solid ' + (f.selected ? BLUE : '#3a4a5e'),
                      background: f.selected ? BLUE : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: '#fff', fontSize: 12, fontWeight: 700,
                    }}>{f.selected ? '\u2713' : ''}</div>

                    {/* File info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <input value={f.title} onChange={e => updateFileField(i, 'title', e.target.value)}
                        style={{ background: 'transparent', border: 'none', color: '#e2e8f0', fontSize: 13,
                          fontWeight: 600, fontFamily: 'inherit', outline: 'none', width: '100%', padding: 0 }} />
                      <div style={{ fontSize: 10, color: DIM, marginTop: 2 }}>
                        {f.name} · {formatFileSize(f.size)} · {f.type.split('/').pop()}
                      </div>
                    </div>

                    {/* Per-file category */}
                    <select value={f.category} onChange={e => updateFileField(i, 'category', e.target.value)}
                      style={{ background: '#0a0e17', border: '1px solid #1e293b', borderRadius: 4,
                        padding: '2px 4px', color: DIM, fontSize: 10, fontFamily: 'inherit', maxWidth: 90 }}>
                      {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </select>

                    {/* Remove */}
                    <button onClick={() => removeFile(i)} style={{
                      background: 'none', border: 'none', color: '#556677', fontSize: 14,
                      cursor: 'pointer', padding: '0 4px', flexShrink: 0,
                    }}>{'\u2715'}</button>
                  </div>
                ))}
              </div>

              {/* Upload button */}
              <button onClick={handleUpload} disabled={!selectedCount || uploading} style={{
                padding: '14px', borderRadius: 8, border: 'none',
                background: selectedCount && !uploading ? GREEN : '#1e293b',
                color: selectedCount && !uploading ? '#000' : DIM,
                cursor: selectedCount && !uploading ? 'pointer' : 'default',
                fontFamily: 'inherit', fontSize: 14, fontWeight: 700,
              }}>
                {uploading ? 'Uploading...' : `\u2191 Upload ${selectedCount} file${selectedCount !== 1 ? 's' : ''}`}
              </button>
            </>
          )}

          {/* Upload results */}
          {uploadResults && (
            <div style={{ background: '#111827', border: '1px solid #1e293b', borderRadius: 8, padding: '12px' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: GREEN, marginBottom: 8 }}>
                {'\u2705'} {uploadResults.filter(r => r.success).length} uploaded — Chat can find them now
              </div>
              {uploadResults.map((r, i) => (
                <div key={i} style={{ fontSize: 11, color: r.success ? '#c8d4e0' : RED, marginBottom: 2 }}>
                  {r.success ? '\u2713' : '\u2717'} {r.name} {r.error ? '— ' + r.error : ''}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══════ MANAGE TAB ══════ */}
      {tab === 'manage' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

          {/* Search and filter */}
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search documents..."
              style={{ flex: 1, background: '#111827', border: '1px solid #3a4a5e', borderRadius: 8,
                padding: '8px 12px', color: '#e2e8f0', fontSize: 13, fontFamily: 'inherit', outline: 'none' }} />
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
              style={{ background: '#111827', border: '1px solid #3a4a5e', borderRadius: 8,
                padding: '8px', color: '#e2e8f0', fontSize: 12, fontFamily: 'inherit' }}>
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="superseded">Superseded</option>
              <option value="archived">Archived</option>
              <option value="draft">Draft</option>
            </select>
          </div>

          {/* Action bar */}
          {selectedDocs.size > 0 && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: BLUE, fontWeight: 600 }}>{selectedDocs.size} selected</span>
              <button onClick={() => { setShowSupersede(true); setSupersedeDoc(null); }} style={{
                background: PURPLE + '22', border: '1px solid ' + PURPLE + '44', borderRadius: 6,
                padding: '5px 10px', color: PURPLE, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
              }}>Supersede...</button>
              <button onClick={handleArchive} style={{
                background: YELLOW + '22', border: '1px solid ' + YELLOW + '44', borderRadius: 6,
                padding: '5px 10px', color: YELLOW, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
              }}>Archive</button>
              <button onClick={handleRestore} style={{
                background: GREEN + '22', border: '1px solid ' + GREEN + '44', borderRadius: 6,
                padding: '5px 10px', color: GREEN, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
              }}>Restore</button>
              <button onClick={clearDocSelection} style={{
                background: 'none', border: '1px solid #2a3a4e', borderRadius: 6,
                padding: '5px 10px', color: DIM, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
              }}>Clear</button>
            </div>
          )}

          {/* Supersede modal */}
          {showSupersede && (
            <div style={{ background: '#111827', border: '1px solid ' + PURPLE + '44', borderRadius: 8, padding: '12px' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: PURPLE, marginBottom: 8 }}>
                Which document supersedes the {selectedDocs.size} selected?
              </div>
              <select value={supersedeDoc?.id || ''} onChange={e => {
                const doc = documents.find(d => d.id === parseInt(e.target.value));
                setSupersedeDoc(doc || null);
              }} style={{ width: '100%', background: '#0a0e17', border: '1px solid #3a4a5e', borderRadius: 6,
                padding: '8px', color: '#e2e8f0', fontSize: 12, fontFamily: 'inherit', marginBottom: 8 }}>
                <option value="">Select the new/replacement document...</option>
                {documents.filter(d => d.status === 'active' && !selectedDocs.has(d.id)).map(d => (
                  <option key={d.id} value={d.id}>{d.title} ({formatDate(d.created_at)})</option>
                ))}
              </select>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setShowSupersede(false)} style={{
                  flex: 1, padding: '8px', borderRadius: 6, border: '1px solid #2a3a4e',
                  background: 'transparent', color: DIM, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12,
                }}>Cancel</button>
                <button onClick={handleSupersede} disabled={!supersedeDoc} style={{
                  flex: 1, padding: '8px', borderRadius: 6, border: 'none',
                  background: supersedeDoc ? PURPLE : '#1e293b',
                  color: supersedeDoc ? '#fff' : DIM,
                  cursor: supersedeDoc ? 'pointer' : 'default', fontFamily: 'inherit', fontSize: 12, fontWeight: 600,
                }}>Supersede</button>
              </div>
            </div>
          )}

          {/* Select all */}
          {filteredDocs.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: DIM }}>{filteredDocs.length} document{filteredDocs.length !== 1 ? 's' : ''}</span>
              <button onClick={selectAllDocs} style={{ background: 'none', border: '1px solid #2a3a4e', borderRadius: 6,
                padding: '3px 8px', color: DIM, fontSize: 10, cursor: 'pointer', fontFamily: 'inherit' }}>Select All</button>
            </div>
          )}

          {/* Document list */}
          {docsLoading && (
            <div style={{ textAlign: 'center', padding: '20px', color: BLUE, fontSize: 13 }}>Loading documents...</div>
          )}

          {!docsLoading && filteredDocs.length === 0 && (
            <div style={{ textAlign: 'center', padding: '30px', color: DIM, fontSize: 13 }}>
              {searchQuery ? 'No documents match your search.' : 'No documents yet. Upload some to get started.'}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 'calc(100vh - 380px)', overflowY: 'auto' }}>
            {filteredDocs.map(d => (
              <div key={d.id} style={{
                display: 'flex', alignItems: 'flex-start', gap: 8,
                background: selectedDocs.has(d.id) ? '#111827' : '#0a0e17',
                border: '1px solid ' + (selectedDocs.has(d.id) ? BLUE + '44' : '#1e293b'),
                borderRadius: 8, padding: '10px 10px',
                opacity: d.status === 'superseded' || d.status === 'archived' ? 0.6 : 1,
              }}>
                {/* Checkbox */}
                <div onClick={() => toggleDocSelect(d.id)} style={{
                  width: 20, height: 20, borderRadius: 4, flexShrink: 0, cursor: 'pointer', marginTop: 2,
                  border: '2px solid ' + (selectedDocs.has(d.id) ? BLUE : '#3a4a5e'),
                  background: selectedDocs.has(d.id) ? BLUE : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontSize: 12, fontWeight: 700,
                }}>{selectedDocs.has(d.id) ? '\u2713' : ''}</div>

                {/* Document info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', marginBottom: 2 }}>
                    {d.title || 'Untitled'}
                    {d.version && <span style={{ fontSize: 10, color: DIM, marginLeft: 6 }}>{d.version}</span>}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 10, color: DIM, marginBottom: 4 }}>
                    <span>{d.category || 'other'}</span>
                    <span>·</span>
                    <span>{d.source_type || 'document'}</span>
                    {d.source_name && <><span>·</span><span>from {d.source_name}</span></>}
                    <span>·</span>
                    <span>{formatDate(d.created_at)}</span>
                    {d.file_type && <><span>·</span><span>{d.file_type.split('/').pop()}</span></>}
                  </div>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <span style={{
                      fontSize: 9, padding: '1px 6px', borderRadius: 4, fontWeight: 600,
                      background: (STATUS_COLORS[d.status] || DIM) + '22',
                      color: STATUS_COLORS[d.status] || DIM,
                      border: '1px solid ' + (STATUS_COLORS[d.status] || DIM) + '44',
                    }}>{STATUS_LABELS[d.status] || d.status}</span>
                    {d.superseded_by && (
                      <span style={{ fontSize: 9, color: DIM }}>
                        → replaced by #{d.superseded_by}
                      </span>
                    )}
                    {d.effective_date && (
                      <span style={{ fontSize: 9, color: DIM }}>
                        effective {formatDate(d.effective_date)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Refresh */}
          {!docsLoading && documents.length > 0 && (
            <button onClick={loadDocuments} style={{
              background: 'none', border: '1px solid #2a3a4e', borderRadius: 8,
              color: DIM, fontSize: 11, padding: '8px', cursor: 'pointer',
              fontFamily: 'inherit', textAlign: 'center',
            }}>Refresh</button>
          )}
        </div>
      )}
    </div>
  );
}
