import { describe, it, expect } from "vitest";
import { ProjectSnapshot, Clip } from "./project.js";

describe("ProjectSnapshot — backwards compatibility", () => {
  it("parses a fully-populated snapshot", () => {
    const result = ProjectSnapshot.safeParse({
      projectId: "proj-1",
      projectName: "test",
      songId: "song-1",
      songFilename: "track.mp3",
      audioUrl: "https://example.com/track.mp3",
      analysis: null,
      clips: [],
      lookbook: [],
      zoom: 1,
      playhead: 0,
    });
    expect(result.success).toBe(true);
  });

  it("parses an empty snapshot (all fields optional)", () => {
    const result = ProjectSnapshot.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts the legacy actTwo source as a tombstone", () => {
    // We removed actTwo from the picker but kept it in the enum so projects
    // saved before the cleanup still load. Regression test for that promise.
    const result = Clip.safeParse({
      id: "c1",
      start: 0,
      end: 5,
      source: "actTwo",
      status: "empty",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown clip source", () => {
    const result = Clip.safeParse({
      id: "c1",
      start: 0,
      end: 5,
      source: "nonsense",
      status: "empty",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a clip with invalid status", () => {
    const result = Clip.safeParse({
      id: "c1",
      start: 0,
      end: 5,
      source: "continue",
      status: "in_progress",
    });
    expect(result.success).toBe(false);
  });
});
