"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Camera,
  ChartColumnIncreasing,
  Cpu,
  Database,
  HardDrive,
  RadioTower,
  Sparkles,
  Upload,
  Video
} from "lucide-react";
import { collectTelemetry } from "@/lib/telemetry";
import type { DetectionResult, HighlightFrame, Telemetry } from "@/lib/types";

const PROCESS_STEPS = [
  "Input validated",
  "Frame extraction ready",
  "Motion gradients generated",
  "Inference pass complete",
  "Results rendered"
];

function formatSeconds(value: number) {
  const mins = Math.floor(value / 60);
  const secs = Math.floor(value % 60);
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

function formatMetric(value: number | null, suffix: string) {
  return value === null ? "Unavailable" : `${value}${suffix}`;
}

function createPointString(
  points: DetectionResult["points"],
  width: number,
  height: number
) {
  return points
    .map((point, index) => {
      const x = (index / Math.max(points.length - 1, 1)) * width;
      const y = height - point.score * height;
      return `${x},${y}`;
    })
    .join(" ");
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
    video.onerror = () => reject(new Error("Video metadata could not be loaded."));
  });

  const canvas = document.createElement("canvas");
  const width = 320;
  const height = 180;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    URL.revokeObjectURL(objectUrl);
    return result.highlights;
  }

  const renderedFrames: HighlightFrame[] = [];
  for (const highlight of result.highlights) {
    const seekTime = Math.min(
      Math.max(0, highlight.timeSeconds),
      Math.max(video.duration - 0.2, 0)
    );
    video.currentTime = seekTime;

    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve();
    });

    context.drawImage(video, 0, 0, width, height);
    renderedFrames.push({
      ...highlight,
      imageUrl: canvas.toDataURL("image/jpeg", 0.88)
    });
  }

  URL.revokeObjectURL(objectUrl);
  return renderedFrames;
}

export function AnomalyConsole() {
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [result, setResult] = useState<DetectionResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [statusText, setStatusText] = useState(
    "Upload a surveillance-style clip to begin anomaly analysis."
  );
  const [cameraUrl, setCameraUrl] = useState("");
  const [currentStep, setCurrentStep] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTelemetry(collectTelemetry());
  }, []);

  useEffect(() => {
    if (!isAnalyzing) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      setCurrentStep((prev) => Math.min(prev + 1, PROCESS_STEPS.length - 1));
    }, 900);

    return () => window.clearInterval(timer);
  }, [isAnalyzing]);

  useEffect(() => {
    return () => {
      if (videoUrl) {
        URL.revokeObjectURL(videoUrl);
      }
    };
  }, [videoUrl]);

  const metrics = useMemo(
    () => [
      {
        label: "Browser Cores",
        value: telemetry?.cpuCores?.toString() ?? "Unavailable",
        icon: Cpu,
        accentClass: "text-orange-300"
      },
      {
        label: "Device Memory",
        value: formatMetric(telemetry?.deviceMemoryGb ?? null, " GB"),
        icon: HardDrive,
        accentClass: "text-emerald-300"
      },
      {
        label: "Heap Usage",
        value: formatMetric(telemetry?.jsHeapUsedMb ?? null, " MB"),
        icon: Database,
        accentClass: "text-sky-300"
      },
      {
        label: "Network",
        value: formatMetric(telemetry?.networkDownlinkMbps ?? null, " Mbps"),
        icon: RadioTower,
        accentClass: "text-yellow-300"
      }
    ],
    [telemetry]
  );

  const handleFileSelect = async (file: File) => {
    if (videoUrl) {
      URL.revokeObjectURL(videoUrl);
    }
    setSelectedFile(file);
    setVideoUrl(URL.createObjectURL(file));
    setResult(null);
    setStatusText(`Video ready: ${file.name}`);
  };

  const runAnalysis = async () => {
    if (!selectedFile) {
      setStatusText("Choose a video first.");
      return;
    }

    setIsAnalyzing(true);
    setCurrentStep(0);
    setStatusText("Starting AnomalyVision analysis pipeline...");

    const formData = new FormData();
    formData.append("video", selectedFile);

    try {
      const baseUrl = process.env.NEXT_PUBLIC_AED_MAE_BACKEND_URL;
      const backendUrl = baseUrl ? `${baseUrl.replace(/\/$/, "")}/analyze` : "/api/analyze";
      const response = await fetch(backendUrl, {
        method: "POST",
        body: formData
      });

      if (!response.ok) {
        throw new Error("Analysis request failed.");
      }

      const payload = (await response.json()) as DetectionResult;
      const withFrames = await extractHighlightFrames(selectedFile, payload);
      setResult({
        ...payload,
        highlights: withFrames
      });
      setStatusText(payload.message);
      setCurrentStep(PROCESS_STEPS.length - 1);
    } catch (error) {
      setStatusText(
        error instanceof Error ? error.message : "Unexpected analysis error."
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  const points = result?.points ?? [];
  const chartPoints = createPointString(points, 680, 240);

  return (
    <main className="relative overflow-hidden">
      <div className="grid-overlay absolute inset-0 opacity-30" />
      <div className="hero-noise absolute inset-0" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-[1600px] flex-col gap-8 px-6 py-8 lg:px-10">
        <section className="tech-frame glass-panel relative overflow-hidden rounded-[32px] px-8 py-8 lg:px-12 lg:py-12">
          <div className="absolute inset-y-0 right-0 hidden w-[42%] bg-[radial-gradient(circle_at_center,rgba(255,106,61,0.22),transparent_58%)] lg:block" />
          <div className="grid gap-8 lg:grid-cols-[1.5fr_0.95fr]">
            <div className="space-y-6">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-[0.32em] text-orange-200">
                <Sparkles className="h-4 w-4 text-orange-300" />
                AnomalyVision AI Surveillance Console
              </div>
              <div className="space-y-4">
                <h1 className="max-w-4xl text-4xl font-semibold leading-tight text-white md:text-6xl">
                  High-tech anomaly detection workspace for uploaded video and future live feeds.
                </h1>
                <p className="max-w-3xl text-base leading-8 text-slate-300 md:text-lg">
                  A premium web-based command center for AnomalyVision. Upload surveillance video,
                  inspect anomaly spikes, preview highlighted frames, and monitor runtime telemetry
                  from a modern AI operations interface.
                </p>
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <FeatureStat
                  label="Primary Path"
                  value="Uploaded Video"
                  helper="Production-ready UX path"
                />
                <FeatureStat
                  label="Live Feed Mode"
                  value="IP Camera Next"
                  helper="UI included, backend can be wired later"
                />
                <FeatureStat
                  label="Result Surface"
                  value="Timeline + Frames"
                  helper="Anomaly curve, highlighted moments, telemetry"
                />
              </div>
            </div>

            <div className="grid gap-4 lg:pt-8">
              {metrics.map((metric) => (
                <TelemetryCard
                  key={metric.label}
                  label={metric.label}
                  value={metric.value}
                  icon={metric.icon}
                  accentClass={metric.accentClass}
                />
              ))}
              <div className="glass-panel tech-frame rounded-[28px] p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-orange-200">
                  GPU Renderer
                </p>
                <p className="mt-3 text-lg font-medium text-white">
                  {telemetry?.gpuRenderer ?? "WebGL information unavailable"}
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-8 xl:grid-cols-[0.96fr_1.34fr]">
          <div className="space-y-8">
            <Panel title="Detection Sources" eyebrow="Input Modes" icon={Video}>
              <div className="grid gap-4">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="tech-frame group relative overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(145deg,rgba(255,106,61,0.18),rgba(103,178,255,0.08))] p-6 text-left transition hover:scale-[1.01] hover:border-orange-300/40"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.28em] text-orange-200">
                        Upload Video
                      </p>
                      <h3 className="mt-2 text-2xl font-semibold text-white">
                        Main production path
                      </h3>
                      <p className="mt-3 max-w-md text-sm leading-7 text-slate-300">
                        Upload `.mp4` or `.avi` surveillance footage and run AnomalyVision anomaly analysis
                        through the upgraded dashboard workflow.
                      </p>
                    </div>
                    <Upload className="h-10 w-10 text-orange-200" />
                  </div>
                </button>

                <div className="glass-panel tech-frame rounded-[28px] p-6">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.28em] text-emerald-300">
                        IP Camera
                      </p>
                      <h3 className="mt-2 text-xl font-semibold text-white">
                        Live feed entry point
                      </h3>
                      <p className="mt-2 text-sm leading-7 text-slate-300">
                        UI is ready for an RTSP or IP camera workflow. Backend streaming capture can
                        be wired in the next phase while upload mode remains the active path now.
                      </p>
                    </div>
                    <Camera className="mt-1 h-8 w-8 text-emerald-300" />
                  </div>
                  <div className="mt-5 grid gap-3">
                    <input
                      value={cameraUrl}
                      onChange={(event) => setCameraUrl(event.target.value)}
                      placeholder="rtsp://camera-address/stream"
                      className="rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500"
                    />
                    <button
                      type="button"
                      className="rounded-2xl border border-emerald-300/30 bg-emerald-300/10 px-4 py-3 text-sm font-medium text-emerald-200 opacity-70"
                    >
                      Connect Camera Soon
                    </button>
                  </div>
                </div>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="video/mp4,video/avi,video/quicktime,video/x-msvideo"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    void handleFileSelect(file);
                  }
                }}
              />
            </Panel>

            <Panel title="Session Control" eyebrow="Pipeline Status" icon={Activity}>
              <div className="grid gap-4">
                <div className="rounded-[24px] border border-white/10 bg-slate-950/70 p-5">
                  <p className="text-sm font-medium text-slate-300">Loaded video</p>
                  <p className="mt-2 text-xl font-semibold text-white">
                    {selectedFile?.name ?? "No file selected"}
                  </p>
                  <p className="mt-3 text-sm text-slate-400">
                    {selectedFile
                      ? `${(selectedFile.size / 1024 / 1024).toFixed(2)} MB`
                      : "Choose a surveillance-style clip to begin."}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={runAnalysis}
                  disabled={!selectedFile || isAnalyzing}
                  className="rounded-[24px] bg-[linear-gradient(90deg,#ff6a3d,#ff9e54)] px-5 py-4 text-base font-semibold text-slate-950 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isAnalyzing ? "Analyzing..." : "Run AnomalyVision Detection"}
                </button>
                <p className="text-sm leading-7 text-slate-300">{statusText}</p>
              </div>
            </Panel>
          </div>

          <div className="space-y-8">
            <Panel title="Video Command Deck" eyebrow="Preview + Processing" icon={ChartColumnIncreasing}>
              <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
                <div className="overflow-hidden rounded-[28px] border border-white/10 bg-slate-950/70">
                  {videoUrl ? (
                    <video
                      src={videoUrl}
                      controls
                      className="aspect-video h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex aspect-video items-center justify-center px-6 text-center text-slate-400">
                      Upload a video to activate the preview deck.
                    </div>
                  )}
                </div>

                <div className="space-y-4 rounded-[28px] border border-white/10 bg-slate-950/70 p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-orange-200">
                    Runtime Pipeline
                  </p>
                  <div className="space-y-4">
                    {PROCESS_STEPS.map((step, index) => {
                      const active = index <= currentStep && (isAnalyzing || result);
                      return (
                        <div key={step} className="flex items-center gap-3">
                          <span
                            className={`signal-dot h-3 w-3 rounded-full ${
                              active ? "bg-orange-300 text-orange-300" : "bg-slate-700 text-slate-700"
                            }`}
                          />
                          <span className={active ? "text-white" : "text-slate-500"}>{step}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="rounded-2xl border border-sky-300/20 bg-sky-300/10 p-4 text-sm leading-7 text-slate-200">
                    Current mode: <span className="font-semibold text-white">
                      {result?.backendMode ? result.backendMode.toUpperCase() : "STANDBY"}
                    </span>
                  </div>
                </div>
              </div>
            </Panel>

            <Panel title="Anomaly Analytics" eyebrow="Scoring Timeline" icon={Activity}>
              <div className="space-y-6">
                <div className="overflow-hidden rounded-[28px] border border-white/10 bg-slate-950/80 p-5">
                  <svg viewBox="0 0 680 260" className="h-[260px] w-full">
                    <defs>
                      <linearGradient id="signalGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="#57f2c3" />
                        <stop offset="45%" stopColor="#67b2ff" />
                        <stop offset="100%" stopColor="#ff6a3d" />
                      </linearGradient>
                    </defs>
                    {[0, 1, 2, 3, 4].map((line) => (
                      <line
                        key={line}
                        x1="0"
                        y1={20 + line * 50}
                        x2="680"
                        y2={20 + line * 50}
                        stroke="rgba(255,255,255,0.08)"
                        strokeDasharray="6 6"
                      />
                    ))}
                    {points.length > 0 ? (
                      <>
                        <polyline
                          fill="none"
                          stroke="url(#signalGradient)"
                          strokeWidth="4"
                          points={chartPoints}
                        />
                        <polyline
                          fill="rgba(255,106,61,0.12)"
                          stroke="transparent"
                          points={`0,240 ${chartPoints} 680,240`}
                        />
                      </>
                    ) : (
                      <text
                        x="340"
                        y="130"
                        textAnchor="middle"
                        fill="#64748b"
                        fontSize="16"
                      >
                        Run analysis to render the anomaly signal.
                      </text>
                    )}
                  </svg>
                </div>

                <div className="grid gap-4 md:grid-cols-4">
                  <ResultMetric
                    label="Peak Score"
                    value={result ? `${result.summary.peakScore}` : "--"}
                  />
                  <ResultMetric
                    label="Peak Timestamp"
                    value={result ? formatSeconds(result.summary.peakTimeSeconds) : "--"}
                  />
                  <ResultMetric
                    label="Analyzed Frames"
                    value={result ? `${result.summary.analyzedFrames}` : "--"}
                  />
                  <ResultMetric
                    label="Process Time"
                    value={result ? `${result.summary.processingTimeSeconds}s` : "--"}
                  />
                </div>
              </div>
            </Panel>
          </div>
        </section>

        <section className="grid gap-8 xl:grid-cols-[1.15fr_0.85fr]">
          <Panel title="Highlighted Frames" eyebrow="Suspicious Moments" icon={Video}>
            <div className="grid gap-4 md:grid-cols-3">
              {(result?.highlights ?? []).length > 0 ? (
                result?.highlights.map((frame) => (
                  <div
                    key={frame.id}
                    className="tech-frame overflow-hidden rounded-[24px] border border-white/10 bg-slate-950/80"
                  >
                    <div className="aspect-video w-full overflow-hidden bg-slate-900">
                      {frame.imageUrl ? (
                        <img
                          src={frame.imageUrl}
                          alt={frame.label}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-slate-500">
                          Frame preview
                        </div>
                      )}
                    </div>
                    <div className="space-y-2 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-orange-200">
                        {frame.label}
                      </p>
                      <p className="text-lg font-semibold text-white">
                        {formatSeconds(frame.timeSeconds)}
                      </p>
                      <p className="text-sm text-slate-400">Score {frame.score}</p>
                    </div>
                  </div>
                ))
              ) : (
                <div className="col-span-full rounded-[24px] border border-dashed border-white/10 bg-slate-950/70 p-8 text-center text-slate-400">
                  Once analysis runs, the dashboard will surface suspicious frames here.
                </div>
              )}
            </div>
          </Panel>

          <Panel title="Ops & Method" eyebrow="Context" icon={Database}>
            <div className="space-y-4">
              <InfoBlock
                title="What works now"
                text="Uploaded video is the primary flow. The frontend already gives you a premium path for loading a clip, running analysis, reviewing scores, and inspecting highlighted frames."
              />
              <InfoBlock
                title="What is staged next"
                text="IP camera and live feed mode are now exposed in the interface, so the backend can be wired later without redesigning the UX."
              />
              <InfoBlock
                title="Telemetry honesty"
                text="The dashboard shows browser and device telemetry today. True backend CPU, RAM, and GPU utilization should come from your inference service once that API is exposed."
              />
              <InfoBlock
                title="Design direction"
                text="The UI is intentionally high-energy and data-rich: glowing signal frames, layered gradients, command-deck cards, and AI-console analytics instead of a plain upload page."
              />
            </div>
          </Panel>
        </section>
      </div>
    </main>
  );
}

function Panel({
  title,
  eyebrow,
  icon: Icon,
  children
}: {
  title: string;
  eyebrow: string;
  icon: typeof Activity;
  children: ReactNode;
}) {
  return (
    <section className="glass-panel tech-frame rounded-[32px] p-6 lg:p-7">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-orange-200">
            {eyebrow}
          </p>
          <h2 className="mt-2 text-2xl font-semibold text-white">{title}</h2>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
          <Icon className="h-5 w-5 text-white" />
        </div>
      </div>
      {children}
    </section>
  );
}

function FeatureStat({
  label,
  value,
  helper
}: {
  label: string;
  value: string;
  helper: string;
}) {
  return (
    <div className="glass-panel tech-frame rounded-[24px] p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.26em] text-slate-400">
        {label}
      </p>
      <p className="mt-3 text-2xl font-semibold text-white">{value}</p>
      <p className="mt-2 text-sm leading-6 text-slate-400">{helper}</p>
    </div>
  );
}

function TelemetryCard({
  label,
  value,
  icon: Icon,
  accentClass
}: {
  label: string;
  value: string;
  icon: typeof Cpu;
  accentClass: string;
}) {
  return (
    <div className="glass-panel tech-frame rounded-[28px] p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
            {label}
          </p>
          <p className="mt-3 text-2xl font-semibold text-white">{value}</p>
        </div>
        <div className={`rounded-2xl border border-white/10 bg-white/5 p-3 ${accentClass}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

function ResultMetric({
  label,
  value
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[22px] border border-white/10 bg-slate-950/70 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
        {label}
      </p>
      <p className="mt-3 text-2xl font-semibold text-white">{value}</p>
    </div>
  );
}

function InfoBlock({
  title,
  text
}: {
  title: string;
  text: string;
}) {
  return (
    <div className="rounded-[22px] border border-white/10 bg-slate-950/70 p-5">
      <h3 className="text-lg font-semibold text-white">{title}</h3>
      <p className="mt-3 text-sm leading-7 text-slate-300">{text}</p>
    </div>
  );
}
