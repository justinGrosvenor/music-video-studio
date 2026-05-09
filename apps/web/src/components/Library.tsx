import { useState, useEffect, useCallback } from "react";
import { useStore } from "../lib/store.js";
import { toast } from "../lib/toast.js";
import { getErrorMessage } from "@mvs/shared";
import {
  listProjects,
  loadProjectFromServer,
  deleteProjectOnServer,
  listRenders,
  listSavedClips,
  deleteClipOnServer,
  type ProjectMeta,
  type RenderEntry,
  type SavedClip,
} from "../lib/api.js";

type Tab = "projects" | "clips" | "renders";

export function Library({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("projects");
  const [projects, setProjects] = useState<ProjectMeta[] | null>(null);
  const [clips, setClips] = useState<SavedClip[] | null>(null);
  const [renders, setRenders] = useState<RenderEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const restoreSnapshot = useStore((s) => s.restoreSnapshot);
  const updateClip = useStore((s) => s.updateClip);
  const selectedClipId = useStore((s) => s.selectedClipId);

  const refresh = useCallback(() => {
    setLoading(true);
    Promise.all([listProjects(), listSavedClips(), listRenders()])
      .then(([p, c, r]) => { setProjects(p); setClips(c); setRenders(r); })
      .catch(() => { setProjects([]); setClips([]); setRenders([]); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const onLoad = async (id: string) => {
    if (!confirm("Load this project? Current unsaved work will be lost.")) return;
    try {
      const saved = await loadProjectFromServer(id);
      restoreSnapshot(saved.state);
      onClose();
      toast.success(`Loaded "${saved.name}"`);
    } catch (err) {
      toast.error(`Failed to load: ${getErrorMessage(err)}`);
    }
  };

  const onDeleteProject = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    try {
      await deleteProjectOnServer(id);
      setProjects((prev) => prev?.filter((p) => p.id !== id) ?? []);
      toast.success("Project deleted");
    } catch (err) {
      toast.error(`Failed to delete: ${getErrorMessage(err)}`);
    }
  };

  const onUseClip = (clip: SavedClip) => {
    if (!selectedClipId) {
      toast.warning("Select a clip on the timeline first, then use a saved clip");
      return;
    }
    updateClip(selectedClipId, {
      source: "library",
      videoUrl: clip.videoUrl,
      status: "ready",
      lastError: undefined,
      generationTaskId: undefined,
      prompt: clip.prompt ?? undefined,
    });
    onClose();
    toast.success(`Applied "${clip.name}" to selected clip`);
  };

  const onDeleteClip = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"?`)) return;
    try {
      await deleteClipOnServer(id);
      setClips((prev) => prev?.filter((c) => c.id !== id) ?? []);
      toast.success("Clip deleted");
    } catch (err) {
      toast.error(`Failed to delete: ${getErrorMessage(err)}`);
    }
  };

  return (
    <div className="library-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="library-modal">
        <div className="library-header">
          <div className="library-tabs">
            <button
              type="button"
              className={`library-tab${tab === "projects" ? " active" : ""}`}
              onClick={() => setTab("projects")}
            >
              Projects
            </button>
            <button
              type="button"
              className={`library-tab${tab === "clips" ? " active" : ""}`}
              onClick={() => setTab("clips")}
            >
              Clips
            </button>
            <button
              type="button"
              className={`library-tab${tab === "renders" ? " active" : ""}`}
              onClick={() => setTab("renders")}
            >
              Renders
            </button>
          </div>
          <button type="button" className="library-close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="library-body">
          {loading ? (
            <div className="library-empty">Loading…</div>
          ) : tab === "projects" ? (
            <ProjectsTab
              projects={projects ?? []}
              onLoad={onLoad}
              onDelete={onDeleteProject}
            />
          ) : tab === "clips" ? (
            <ClipsTab
              clips={clips ?? []}
              onUse={onUseClip}
              onDelete={onDeleteClip}
              hasSelection={!!selectedClipId}
            />
          ) : (
            <RendersTab renders={renders ?? []} />
          )}
        </div>
      </div>
    </div>
  );
}

function ProjectsTab({
  projects,
  onLoad,
  onDelete,
}: {
  projects: ProjectMeta[];
  onLoad: (id: string) => void;
  onDelete: (id: string, name: string) => void;
}) {
  if (!projects.length) {
    return <div className="library-empty">No saved projects yet. Hit Save to keep your work.</div>;
  }

  return (
    <div className="library-grid">
      {projects.map((p) => (
        <div key={p.id} className="library-card">
          <div
            className="library-card-thumb"
            style={p.thumbnailUrl ? { backgroundImage: `url(${p.thumbnailUrl})` } : undefined}
          />
          <div className="library-card-info">
            <div className="library-card-name">{p.name}</div>
            <div className="library-card-date">
              {new Date(p.savedAt).toLocaleDateString()} {new Date(p.savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </div>
          </div>
          <div className="library-card-actions">
            <button type="button" className="btn" onClick={() => onLoad(p.id)}>Open</button>
            <button type="button" className="btn ghost" onClick={() => onDelete(p.id, p.name)}>Delete</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function ClipsTab({
  clips,
  onUse,
  onDelete,
  hasSelection,
}: {
  clips: SavedClip[];
  onUse: (clip: SavedClip) => void;
  onDelete: (id: string, name: string) => void;
  hasSelection: boolean;
}) {
  if (!clips.length) {
    return <div className="library-empty">No saved clips yet. Generate a clip, then save it from the sidebar.</div>;
  }

  return (
    <div className="library-grid">
      {clips.map((c) => (
        <div key={c.id} className="library-card">
          <video
            className="library-card-thumb"
            src={c.videoUrl}
            muted
            playsInline
            preload="metadata"
            onMouseEnter={(e) => (e.target as HTMLVideoElement).play().catch(() => {})}
            onMouseLeave={(e) => { const v = e.target as HTMLVideoElement; v.pause(); v.currentTime = 0; }}
          />
          <div className="library-card-info">
            <div className="library-card-name">{c.name}</div>
            <div className="library-card-date">
              {c.duration.toFixed(1)}s · {c.source}
              {c.sectionLabel ? ` · ${c.sectionLabel}` : ""}
            </div>
          </div>
          <div className="library-card-actions">
            <button
              type="button"
              className="btn"
              onClick={() => onUse(c)}
              title={hasSelection ? "Apply to selected timeline clip" : "Select a timeline clip first"}
              disabled={!hasSelection}
            >
              Use
            </button>
            <a href={c.videoUrl} target="_blank" rel="noreferrer" className="btn ghost">View</a>
            <button type="button" className="btn ghost" onClick={() => onDelete(c.id, c.name)}>Delete</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function RendersTab({ renders }: { renders: RenderEntry[] }) {
  if (!renders.length) {
    return <div className="library-empty">No renders yet. Export an MP4 from the editor.</div>;
  }

  return (
    <div className="library-grid">
      {renders.map((r) => (
        <div key={r.name} className="library-card">
          <video
            className="library-card-thumb"
            src={r.url}
            muted
            playsInline
            preload="metadata"
            onMouseEnter={(e) => (e.target as HTMLVideoElement).play().catch(() => {})}
            onMouseLeave={(e) => { const v = e.target as HTMLVideoElement; v.pause(); v.currentTime = 0; }}
          />
          <div className="library-card-info">
            <div className="library-card-name">{r.name}</div>
            <div className="library-card-date">
              {formatSize(r.size)} · {new Date(r.modifiedAt).toLocaleDateString()}
            </div>
          </div>
          <div className="library-card-actions">
            <a href={r.url} target="_blank" rel="noreferrer" className="btn">View</a>
            <a href={r.url} download className="btn ghost">Download</a>
          </div>
        </div>
      ))}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
