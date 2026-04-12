import type { DetectionResult, HighlightFrame } from "@/lib/types";
import {
  clearDetectionSession,
  loadDetectionSession,
  saveDetectionSession,
  saveLastDetection
} from "@/lib/ui-settings";

export type DetectionSessionState = {
  selectedFile: File | null;
  videoUrl: string | null;
  result: DetectionResult | null;
  statusText: string;
  isAnalyzing: boolean;
  stepIndex: number;
  progressPercent: number;
  cameraUrl: string;
};

const PROCESS_LABELS = [
  "Validating input video...",
  "Extracting frames...",
  "Generating motion gradients...",
  "Running AnomalyVision inference...",
  "Preparing final results..."
];

let initialized = false;
let inFlight: Promise<boolean> | null = null;
let state: DetectionSessionState = {
  selectedFile: null,
  videoUrl: null,
  result: null,
  statusText: "Upload a surveillance clip and start anomaly detection.",
  isAnalyzing: false,
  stepIndex: 0,
  progressPercent: 0,
  cameraUrl: ""
};

const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

function ensureInitialized() {
  if (initialized || typeof window === "undefined") {
    return;
  }
  const restored = loadDetectionSession();
  if (restored) {
    state = {
      ...state,
      result: restored.result,
      statusText: restored.statusText,
      progressPercent: restored.result ? 100 : 0,
      stepIndex: restored.result ? 4 : 0
    };
  }
  initialized = true;
}

function setState(next: Partial<DetectionSessionState>) {
  state = { ...state, ...next };
  emit();
}

async function extractHighlightFrames(file: File, result: DetectionResult) {
  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "metadata";
  video.src = objectUrl;
  video.muted = true;
  video.playsInline = true;

  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("Could not decode uploaded video metadata."));
  });

  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 180;
  const context = canvas.getContext("2d");
  if (!context) {
    URL.revokeObjectURL(objectUrl);
    return result.highlights;
  }

  const resolved: HighlightFrame[] = [];
  for (const frame of result.highlights) {
    if (frame.imageUrl) {
      resolved.push(frame);
      continue;
    }

    const target = Math.min(Math.max(0, frame.timeSeconds), Math.max(video.duration - 0.2, 0));
    video.currentTime = target;

    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve();
    });

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    resolved.push({
      ...frame,
      imageUrl: canvas.toDataURL("image/jpeg", 0.88)
    });
  }

  URL.revokeObjectURL(objectUrl);
  return resolved;
}

export function getDetectionSessionState(): DetectionSessionState {
  ensureInitialized();
  return state;
}

export function subscribeDetectionSession(listener: () => void) {
  ensureInitialized();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setDetectionCameraUrl(value: string) {
  setState({ cameraUrl: value });
}

export function setDetectionInputFile(file: File) {
  const validType = file.type.startsWith("video/") || /\.(mp4|avi|mov|mkv)$/i.test(file.name);
  if (!validType) {
    setState({ statusText: "Unsupported file type. Use MP4, AVI, MOV, or MKV." });
    return;
  }

  if (file.size > 380 * 1024 * 1024) {
    setState({ statusText: "File too large for this frontend session. Please use video under 380MB." });
    return;
  }

  if (state.videoUrl) {
    URL.revokeObjectURL(state.videoUrl);
  }

  setState({
    selectedFile: file,
    videoUrl: URL.createObjectURL(file),
    result: null,
    stepIndex: 0,
    progressPercent: 0,
    statusText: `Loaded ${file.name}. Ready to detect anomalies.`
  });
  clearDetectionSession();
}

export function clearDetectionSessionState() {
  if (state.videoUrl) {
    URL.revokeObjectURL(state.videoUrl);
  }
  setState({
    selectedFile: null,
    videoUrl: null,
    result: null,
    statusText: "Session reset. Upload another clip.",
    isAnalyzing: false,
    stepIndex: 0,
    progressPercent: 0
  });
  clearDetectionSession();
}

export async function runDetectionRequest(): Promise<boolean> {
  ensureInitialized();

  if (!state.selectedFile) {
    setState({ statusText: "Select a video first." });
    return false;
  }

  if (state.isAnalyzing && inFlight) {
    return inFlight;
  }

  inFlight = (async () => {
    setState({
      isAnalyzing: true,
      stepIndex: 0,
      progressPercent: 3,
      statusText: PROCESS_LABELS[0]
    });

    let progress = 3;
    let stage = 0;
    const timer = window.setInterval(() => {
      progress = Math.min(95, progress + Math.floor(Math.random() * 7) + 2);
      if (progress > 18 && stage < 1) {
        stage = 1;
      }
      if (progress > 38 && stage < 2) {
        stage = 2;
      }
      if (progress > 62 && stage < 3) {
        stage = 3;
      }
      if (progress > 82 && stage < 4) {
        stage = 4;
      }

      setState({
        progressPercent: progress,
        stepIndex: stage,
        statusText: PROCESS_LABELS[stage]
      });
    }, 800);

    try {
      const payload = new FormData();
      payload.append("video", state.selectedFile as File);

      const baseUrl = process.env.NEXT_PUBLIC_AED_MAE_BACKEND_URL;
      const backendUrl = baseUrl ? `${baseUrl.replace(/\/$/, "")}/analyze` : "/api/analyze";
      const response = await fetch(backendUrl, {
        method: "POST",
        body: payload
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string; details?: string }
          | null;
        const msg = payload?.error ?? `Detection failed with status ${response.status}`;
        throw new Error(msg);
      }

      const data = (await response.json()) as DetectionResult;
      const selectedFile = state.selectedFile as File;
      const highlights = await extractHighlightFrames(selectedFile, data);
      const finalResult: DetectionResult = {
        ...data,
        highlights
      };

      setState({
        result: finalResult,
        stepIndex: 4,
        progressPercent: 100,
        statusText: finalResult.message,
        isAnalyzing: false
      });

      saveLastDetection({
        timestamp: Date.now(),
        fileName: selectedFile.name,
        backendMode: finalResult.backendMode,
        summary: finalResult.summary,
        highlightCount: finalResult.highlights.length
      });

      saveDetectionSession({
        timestamp: Date.now(),
        fileName: selectedFile.name,
        statusText: finalResult.message,
        result: finalResult
      });

      return true;
    } catch (error) {
      setState({
        statusText: error instanceof Error ? error.message : "Unexpected detection error",
        isAnalyzing: false
      });
      return false;
    } finally {
      window.clearInterval(timer);
      inFlight = null;
    }
  })();

  return inFlight;
}
