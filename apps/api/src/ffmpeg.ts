import { spawn } from "node:child_process";

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Carries ffmpeg's stderr without exposing it through `.message` (which the
 * global error handler returns to the client). Pino logs the full object, so
 * stderr lands in server logs while clients see a generic message.
 */
export class FfmpegError extends Error {
  readonly stderr: string;
  constructor(message: string, stderr: string) {
    super(message);
    this.name = "FfmpegError";
    this.stderr = stderr;
  }
}

export function runFfmpeg(args: string[], timeoutMs = DEFAULT_TIMEOUT_MS): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGKILL");
    }, timeoutMs);
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      const tail = stderr.slice(-2000);
      if (timedOut) reject(new FfmpegError("ffmpeg timed out", tail));
      else if (code === 0) resolve();
      else reject(new FfmpegError(`ffmpeg failed (exit ${code})`, tail));
    });
  });
}
