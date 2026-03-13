import React, { useState, useEffect } from 'react';

export default function DirectoryPicker({ initialPath, onSelect, onClose }) {
  const [currentPath, setCurrentPath] = useState(initialPath || '');
  const [inputPath, setInputPath] = useState(initialPath || '');
  const [dirs, setDirs] = useState([]);
  const [parentDir, setParentDir] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const fetchDir = async (path) => {
    setLoading(true);
    setError(null);
    try {
      const url = path
        ? `/api/browse-dir?path=${encodeURIComponent(path)}`
        : '/api/browse-dir';
      const res = await fetch(url);
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to browse directory');
        setLoading(false);
        return;
      }
      const data = await res.json();
      setCurrentPath(data.current);
      setInputPath(data.current);
      setParentDir(data.parent);
      setDirs(data.dirs);
    } catch {
      setError('Failed to connect to server');
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchDir(initialPath || '');
  }, []);

  const navigateTo = (dirName) => {
    fetchDir(currentPath + '/' + dirName);
  };

  const navigateToParent = () => {
    if (parentDir) fetchDir(parentDir);
  };

  const handleInputKeyDown = (e) => {
    if (e.key === 'Enter') {
      fetchDir(inputPath);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 200,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 500, maxHeight: '70vh',
          display: 'flex', flexDirection: 'column',
          padding: 24,
          background: 'var(--bg1)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          animation: 'fade-in 0.2s ease-out',
        }}
      >
        <h2 style={{
          fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 16,
          marginBottom: 16,
        }}>
          Select Directory
        </h2>

        {/* Path input */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input
            type="text"
            value={inputPath}
            onChange={e => setInputPath(e.target.value)}
            onKeyDown={handleInputKeyDown}
            style={{
              flex: 1, padding: '6px 10px', fontSize: 12,
              background: 'var(--bg)', border: '1px solid var(--border)',
              borderRadius: 4, color: 'var(--text)',
            }}
          />
          <button
            onClick={() => fetchDir(inputPath)}
            style={{
              padding: '6px 12px', fontSize: 12,
              background: 'var(--bg2)', border: '1px solid var(--border)',
              borderRadius: 4, color: 'var(--text)',
            }}
          >
            Go
          </button>
        </div>

        {error && (
          <div style={{ color: 'var(--red)', fontSize: 11, marginBottom: 8 }}>
            {error}
          </div>
        )}

        {/* Directory list */}
        <div style={{
          flex: 1, overflowY: 'auto', minHeight: 200,
          border: '1px solid var(--border)', borderRadius: 4,
          background: 'var(--bg)',
        }}>
          {loading ? (
            <div style={{ padding: 16, color: 'var(--text3)', fontSize: 12, textAlign: 'center' }}>
              Loading...
            </div>
          ) : (
            <>
              {parentDir && (
                <div
                  onClick={navigateToParent}
                  style={{
                    padding: '8px 12px', fontSize: 12,
                    cursor: 'pointer', color: 'var(--text2)',
                    borderBottom: '1px solid var(--border)',
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg2)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <span style={{ fontSize: 14 }}>..</span>
                  <span style={{ color: 'var(--text3)' }}>(parent)</span>
                </div>
              )}
              {dirs.length === 0 && !parentDir && (
                <div style={{ padding: 16, color: 'var(--text3)', fontSize: 12, textAlign: 'center' }}>
                  No subdirectories
                </div>
              )}
              {dirs.map(dir => (
                <div
                  key={dir}
                  onClick={() => navigateTo(dir)}
                  style={{
                    padding: '8px 12px', fontSize: 12,
                    cursor: 'pointer', color: 'var(--text)',
                    borderBottom: '1px solid var(--border)',
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg2)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <span style={{ color: 'var(--amber)' }}>&#x1F4C1;</span>
                  {dir}
                </div>
              ))}
            </>
          )}
        </div>

        {/* Current selection */}
        <div style={{ marginTop: 12, fontSize: 11, color: 'var(--text3)' }}>
          Selected: <span style={{ color: 'var(--text)' }}>{currentPath}</span>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button
            onClick={onClose}
            style={{ padding: '8px 16px', color: 'var(--text2)', fontSize: 12 }}
          >
            Cancel
          </button>
          <button
            onClick={() => onSelect(currentPath)}
            style={{
              padding: '8px 20px',
              background: 'var(--amber)', color: '#000',
              borderRadius: 4, fontWeight: 500, fontSize: 12,
            }}
          >
            Select
          </button>
        </div>
      </div>
    </div>
  );
}
