import { useState } from 'react';
import {
  useShExMapAcl,
  useGrantShExMapAcl,
  useRevokeShExMapAcl,
  usePairingAcl,
  useGrantPairingAcl,
  useRevokePairingAcl,
  type AclEntry,
} from '../../api/acl.js';

// UUID v4 regex (loose but sufficient for client-side validation)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(v: string): boolean {
  return UUID_RE.test(v.trim());
}

// ─── Shared inner component ───────────────────────────────────────────────────

interface InnerProps {
  entries: AclEntry[] | undefined;
  isLoading: boolean;
  listError: Error | null;
  grantError: Error | null;
  revokeError: Error | null;
  isGranting: boolean;
  isRevoking: boolean;
  onGrant: (userId: string) => void;
  onRevoke: (userId: string) => void;
}

function AccessList({
  entries,
  isLoading,
  listError,
  grantError,
  revokeError,
  isGranting,
  onGrant,
  onRevoke,
}: InnerProps) {
  const [input, setInput] = useState('');
  const [validationErr, setValidationErr] = useState('');

  function handleAdd() {
    const userId = input.trim();
    if (!isValidUuid(userId)) {
      setValidationErr('Please enter a valid UUID (e.g. 550e8400-e29b-41d4-a716-446655440000)');
      return;
    }
    setValidationErr('');
    onGrant(userId);
    setInput('');
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') handleAdd();
  }

  return (
    <div className="space-y-3 mt-3">
      {/* Current grants */}
      {isLoading && (
        <p className="text-xs text-slate-400">Loading access list…</p>
      )}
      {listError && (
        <p className="text-xs text-red-500">Failed to load access list: {listError.message}</p>
      )}
      {!isLoading && !listError && entries !== undefined && (
        <>
          {entries.length === 0 ? (
            <p className="text-xs text-slate-400 italic">No additional users have write access.</p>
          ) : (
            <ul className="space-y-1.5">
              {entries.map((entry) => (
                <li
                  key={entry.authorizationIri}
                  className="flex items-center justify-between gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2"
                >
                  <div className="min-w-0">
                    <span className="font-mono text-xs text-slate-700 truncate block">{entry.agentUserId}</span>
                    <span className="text-xs text-slate-400">{entry.mode} access</span>
                  </div>
                  <button
                    onClick={() => onRevoke(entry.agentUserId)}
                    title="Revoke access"
                    className="shrink-0 text-slate-400 hover:text-red-500 transition-colors ml-1"
                    aria-label={`Revoke access for ${entry.agentUserId}`}
                  >
                    <svg viewBox="0 0 16 16" className="w-4 h-4 fill-current" aria-hidden="true">
                      <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06z" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {/* Add-user form */}
      <div className="flex gap-2 items-center">
        <input
          type="text"
          value={input}
          onChange={(e) => { setInput(e.target.value); setValidationErr(''); }}
          onKeyDown={handleKeyDown}
          placeholder="User UUID"
          aria-label="User UUID to grant access"
          className="flex-1 bg-slate-700 text-slate-200 placeholder-slate-500 border border-slate-600 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:border-violet-400"
        />
        <button
          onClick={handleAdd}
          disabled={isGranting || !input.trim()}
          className="shrink-0 text-xs px-3 py-1.5 rounded bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-50 font-medium transition-colors"
        >
          {isGranting ? 'Adding…' : 'Add'}
        </button>
      </div>

      {validationErr && (
        <p className="text-xs text-red-400">{validationErr}</p>
      )}
      {grantError && (
        <p className="text-xs text-red-400">Grant failed: {(grantError as { response?: { data?: { error?: string } }; message?: string }).response?.data?.error ?? (grantError as { message?: string }).message}</p>
      )}
      {revokeError && (
        <p className="text-xs text-red-400">Revoke failed: {(revokeError as { response?: { data?: { error?: string } }; message?: string }).response?.data?.error ?? (revokeError as { message?: string }).message}</p>
      )}
    </div>
  );
}

// ─── Public component ─────────────────────────────────────────────────────────

export interface ManageAccessPanelProps {
  resourceId: string;
  resourceKind: 'shexmap' | 'pairing';
  isOwner: boolean;
}

export default function ManageAccessPanel({ resourceId, resourceKind, isOwner }: ManageAccessPanelProps) {
  const [open, setOpen] = useState(false);

  // All hooks unconditional (hooks must not be called conditionally)
  const shexAcl     = useShExMapAcl(resourceKind === 'shexmap' ? resourceId : '');
  const grantShex   = useGrantShExMapAcl(resourceKind === 'shexmap' ? resourceId : '');
  const revokeShex  = useRevokeShExMapAcl(resourceKind === 'shexmap' ? resourceId : '');

  const pairingAcl     = usePairingAcl(resourceKind === 'pairing' ? resourceId : '');
  const grantPairing   = useGrantPairingAcl(resourceKind === 'pairing' ? resourceId : '');
  const revokePairing  = useRevokePairingAcl(resourceKind === 'pairing' ? resourceId : '');

  if (!isOwner) return null;
  if (!resourceId) return null;

  const entries    = resourceKind === 'shexmap' ? shexAcl.data    : pairingAcl.data;
  const isLoading  = resourceKind === 'shexmap' ? shexAcl.isLoading : pairingAcl.isLoading;
  const listError  = resourceKind === 'shexmap' ? shexAcl.error   : pairingAcl.error;
  const grantMut   = resourceKind === 'shexmap' ? grantShex        : grantPairing;
  const revokeMut  = resourceKind === 'shexmap' ? revokeShex       : revokePairing;

  return (
    <div className="border-t border-slate-600 mt-3 pt-3">
      <button
        onClick={() => setOpen((s) => !s)}
        className="text-xs text-slate-400 hover:text-slate-200 transition-colors flex items-center gap-1"
        aria-expanded={open}
      >
        <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 fill-current" aria-hidden="true">
          <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0Zm-.25 4.75a.75.75 0 0 0 0 1.5h.5a.75.75 0 0 0 0-1.5h-.5ZM8 7a.75.75 0 0 0-.75.75v3.5a.75.75 0 0 0 1.5 0v-3.5A.75.75 0 0 0 8 7Z" />
        </svg>
        {open ? 'Hide access ▲' : 'Manage access ▼'}
      </button>

      {open && (
        <AccessList
          entries={entries}
          isLoading={isLoading}
          listError={listError}
          grantError={grantMut.error}
          revokeError={revokeMut.error}
          isGranting={grantMut.isPending}
          isRevoking={revokeMut.isPending}
          onGrant={(userId) => grantMut.mutate(userId)}
          onRevoke={(userId) => revokeMut.mutate(userId)}
        />
      )}
    </div>
  );
}
