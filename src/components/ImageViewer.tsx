import { useCallback, useEffect, useRef, useState } from 'react';
import type { AssetRef } from '../lib/types';
import { useAssetUrl } from '../hooks';

export const neutralLabel = (i: number, a: AssetRef) => `Gambar ${String.fromCharCode(65 + (i % 26))}${i >= 26 ? Math.floor(i / 26) : ''} — ${a.label}`;

interface View {
  scale: number;
  x: number;
  y: number;
}
const RESET: View = { scale: 1, x: 0, y: 0 };
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function ZoomableImage({ asset, label, fullscreen }: { asset: AssetRef; label: string; fullscreen: boolean }) {
  const { url, missing } = useAssetUrl(asset.blobKey);
  const [view, setView] = useState<View>(RESET);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; scale: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => setView(RESET), [asset.blobKey]);

  const zoomBy = useCallback((f: number) => setView((v) => {
    const scale = clamp(v.scale * f, 1, 8);
    return scale === 1 ? RESET : { ...v, scale };
  }), []);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomBy, url]);

  if (missing) return <div className="img-missing">Aset tidak tersedia di perangkat ini.</div>;
  if (!url) return <div className="img-missing">Memuat gambar…</div>;

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale: view.scale };
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const scale = clamp((pinch.current.scale * d) / pinch.current.dist, 1, 8);
      setView((v) => (scale === 1 ? RESET : { ...v, scale }));
    } else if (pointers.current.size === 1 && view.scale > 1) {
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };

  return (
    <div className={`zoom-wrap ${fullscreen ? 'fs' : ''}`}>
      <div
        ref={boxRef}
        className="zoom-box"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => (view.scale > 1 ? setView(RESET) : zoomBy(2))}
        style={{ cursor: view.scale > 1 ? 'grab' : 'zoom-in' }}
      >
        <img
          src={url}
          alt={label}
          draggable={false}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
        />
      </div>
      <div className="zoom-controls" role="toolbar" aria-label="Kontrol zoom">
        <button onClick={() => zoomBy(1 / 1.4)} aria-label="Perkecil" disabled={view.scale <= 1}>
          −
        </button>
        <span className="muted small">{Math.round(view.scale * 100)}%</span>
        <button onClick={() => zoomBy(1.4)} aria-label="Perbesar">
          +
        </button>
        <button onClick={() => setView(RESET)} disabled={view.scale === 1}>
          Reset
        </button>
      </div>
    </div>
  );
}

export default function ImageViewer({ assets, revealCaptions }: { assets: AssetRef[]; revealCaptions: boolean }) {
  const [index, setIndex] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const asset = assets[Math.min(index, assets.length - 1)];
  const label = neutralLabel(index, asset);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false);
      if (e.key === 'ArrowRight') setIndex((i) => Math.min(assets.length - 1, i + 1));
      if (e.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1));
    };
    window.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('no-scroll');
    };
  }, [fullscreen, assets.length]);

  const nav = (
    <div className="img-nav">
      <button onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={index === 0} aria-label="Gambar sebelumnya">
        ‹
      </button>
      <div className="img-tabs" role="tablist">
        {assets.map((a, i) => (
          <button key={i} role="tab" aria-selected={i === index} className={i === index ? 'active' : ''} onClick={() => setIndex(i)}>
            {neutralLabel(i, a)}
          </button>
        ))}
      </div>
      <button onClick={() => setIndex((i) => Math.min(assets.length - 1, i + 1))} disabled={index === assets.length - 1} aria-label="Gambar berikutnya">
        ›
      </button>
    </div>
  );

  const body = (
    <>
      <div className="img-header">
        <strong data-testid="image-label">{label}</strong>
        {asset.modality && <span className="muted small"> · {asset.modality}</span>}
        <button className="fs-btn" onClick={() => setFullscreen((f) => !f)}>
          {fullscreen ? 'Tutup layar penuh' : 'Layar penuh'}
        </button>
      </div>
      <ZoomableImage key={asset.blobKey ?? index} asset={asset} label={label} fullscreen={fullscreen} />
      {revealCaptions && asset.caption && <p className="caption" data-testid="image-caption">Keterangan: {asset.caption}</p>}
      {assets.length > 1 && nav}
    </>
  );

  if (fullscreen)
    return (
      <>
        <div className="img-placeholder muted small">Gambar dibuka di layar penuh.</div>
        <div className="fullscreen" role="dialog" aria-modal="true" aria-label={label}>
          {body}
        </div>
      </>
    );
  return <div className="viewer">{body}</div>;
}
