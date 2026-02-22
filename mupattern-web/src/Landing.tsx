import { useEffect, useRef, useState } from "react";
import { HexBackground, Button, ThemeToggle, useTheme } from "@mupattern/shared";
import {
  RefreshCw,
  Crop,
  BarChart3,
  Crosshair,
  CircleDot,
  Layers,
  ArrowDown,
  Download,
  Globe,
  Github,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

/* ── useInView ─────────────────────────────────────── */

function useInView(threshold = 0.15) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.unobserve(el);
        }
      },
      { threshold },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold]);

  return { ref, inView };
}

/* ── Data ──────────────────────────────────────────── */

const FEATURES = [
  {
    icon: RefreshCw,
    title: "Convert",
    desc: "Import TIFF stacks or convert ND2 files to TIFF. Preserves metadata and multi-dimensional structure.",
  },
  {
    icon: Crop,
    title: "Crop",
    desc: "Auto-detect and extract micropattern regions of interest from full-frame images.",
  },
  {
    icon: BarChart3,
    title: "Expression",
    desc: "Quantify fluorescence intensity across patterns over time with background correction.",
  },
  {
    icon: Crosshair,
    title: "Kill",
    desc: "Detect cell death events using deep learning with monotonicity correction.",
  },
  {
    icon: CircleDot,
    title: "Spot",
    desc: "Identify and count fluorescent spots per cell with sub-pixel accuracy.",
  },
  {
    icon: Layers,
    title: "Tissue",
    desc: "Segment tissue morphology with Cellpose and CellSAM for comprehensive cell analysis.",
  },
] as const;

const PIPELINE = [
  { n: 1, title: "Import", desc: "Point to your TIFF stacks. Multi-position, multi-channel, time-lapse — all supported." },
  { n: 2, title: "Crop", desc: "Automatic micropattern region extraction into Zarr v3. No manual ROI selection." },
  { n: 3, title: "Analyze", desc: "Run expression, kill, spot, or tissue pipelines — powered by ONNX inference on your hardware." },
  { n: 4, title: "Results", desc: "Export clean CSVs with per-crop, per-timepoint measurements. Ready for plotting and publication." },
] as const;

const TECH = ["Rust", "ONNX Runtime", "Zarr v3", "Cellpose", "CellSAM", "TypeScript", "Electron"];

/* ── Helpers ───────────────────────────────────────── */

function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const { ref, inView } = useInView();
  return (
    <div
      ref={ref}
      className={className ?? ""}
      style={{
        opacity: inView ? 1 : 0,
        transform: inView ? "translateY(0)" : "translateY(36px)",
        transition: "opacity 0.7s cubic-bezier(0.16,1,0.3,1), transform 0.7s cubic-bezier(0.16,1,0.3,1)",
        transitionDelay: `${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  desc,
  delay,
}: {
  icon: React.ElementType;
  title: string;
  desc: string;
  delay: number;
}) {
  const { ref, inView } = useInView();
  return (
    <div
      ref={ref}
      className="rounded-xl border p-6 backdrop-blur-sm bg-background/60 transition-all duration-300 hover:-translate-y-1.5"
      style={{
        opacity: inView ? 1 : 0,
        transform: inView ? undefined : "translateY(36px)",
        transition: "opacity 0.7s cubic-bezier(0.16,1,0.3,1), transform 0.7s cubic-bezier(0.16,1,0.3,1)",
        transitionDelay: `${delay}ms`,
      }}
    >
      <div className="mb-4 inline-flex rounded-lg p-2.5 bg-muted">
        <Icon className="size-6 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-medium mb-1">{title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
    </div>
  );
}

function PipelineStep({
  n,
  title,
  desc,
  delay,
  isLast,
}: {
  n: number;
  title: string;
  desc: string;
  delay: number;
  isLast?: boolean;
}) {
  const { ref, inView } = useInView();
  return (
    <div className="relative flex gap-4">
      {!isLast && (
        <div
          className="absolute left-[19px] top-[44px] bottom-0 w-0.5"
          style={{ background: "linear-gradient(to bottom, var(--border) 0%, transparent 100%)" }}
        />
      )}
      <div
        ref={ref}
        className="flex gap-4"
        style={{
          opacity: inView ? 1 : 0,
          transform: inView ? "translateY(0)" : "translateY(36px)",
          transition: "opacity 0.7s cubic-bezier(0.16,1,0.3,1), transform 0.7s cubic-bezier(0.16,1,0.3,1)",
          transitionDelay: `${delay}ms`,
        }}
      >
        <div
          className="size-10 rounded-full border-2 flex items-center justify-center shrink-0 font-medium text-sm border-foreground/20"
        >
          {n}
        </div>
        <div className="pb-12">
          <h3 className="font-medium text-lg">{title}</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-md">{desc}</p>
        </div>
      </div>
    </div>
  );
}

/* ── Mock window data ──────────────────────────────── */

const MOCK_CROPS = [
  { b: 0.85, spots: 4, alive: true,  int: 1089, area: 115 },
  { b: 0.35, spots: 0, alive: true,  int: 421,  area: 85  },
  { b: 0.70, spots: 8, alive: true,  int: 945,  area: 108 },
  { b: 0.60, spots: 0, alive: true,  int: 734,  area: 98  },
  { b: 0.15, spots: 0, alive: false, int: 156,  area: 72  },
  { b: 0.90, spots: 2, alive: true,  int: 1367, area: 118 },
  { b: 0.40, spots: 0, alive: true,  int: 445,  area: 82  },
  { b: 0.75, spots: 5, alive: true,  int: 892,  area: 105 },
  { b: 0.55, spots: 3, alive: true,  int: 723,  area: 96  },
  { b: 0.30, spots: 0, alive: true,  int: 312,  area: 78  },
  { b: 0.80, spots: 3, alive: true,  int: 1205, area: 112 },
  { b: 0.45, spots: 0, alive: true,  int: 534,  area: 88  },
  { b: 0.90, spots: 1, alive: true,  int: 1298, area: 121 },
  { b: 0.10, spots: 0, alive: false, int: 89,   area: 65  },
  { b: 0.65, spots: 1, alive: true,  int: 689,  area: 95  },
  { b: 0.50, spots: 0, alive: true,  int: 578,  area: 91  },
  { b: 0.70, spots: 6, alive: true,  int: 876,  area: 102 },
  { b: 0.20, spots: 0, alive: false, int: 201,  area: 70  },
];

const SPOT_XY = [
  [32, 28], [58, 38], [38, 62], [62, 28], [28, 48],
  [52, 58], [42, 32], [58, 52], [35, 42], [55, 68],
  [48, 25], [65, 42],
];

/** Interactive mock app window */
function MockWindow() {
  const [selected, setSelected] = useState<number | null>(null);
  const [tp, setTp] = useState(0);
  const totalTp = 12;

  const sel = selected !== null ? MOCK_CROPS[selected] : null;

  // Slight intensity drift per timepoint to simulate time-lapse
  const tpOffset = tp;

  return (
    <div
      className="relative rounded-xl border bg-background overflow-hidden shadow-2xl w-full"
      style={{ transform: "perspective(1400px) rotateX(3deg)" }}
    >
      {/* Title bar */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b bg-muted/60">
        <div className="size-3 rounded-full bg-red-500/60" />
        <div className="size-3 rounded-full bg-yellow-500/60" />
        <div className="size-3 rounded-full bg-green-500/60" />
        <span className="ml-3 text-xs text-muted-foreground flex-1">mupattern — crops.zarr</span>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="mr-1">pos: 042</span>
          <span className="text-muted-foreground/25">|</span>
          <button
            onClick={() => setTp(Math.max(0, tp - 1))}
            className="hover:text-foreground transition-colors p-0.5"
          >
            <ChevronLeft className="size-3" />
          </button>
          <span className="tabular-nums w-12 text-center text-[10px]">t: {tp}/{totalTp}</span>
          <button
            onClick={() => setTp(Math.min(totalTp, tp + 1))}
            className="hover:text-foreground transition-colors p-0.5"
          >
            <ChevronRight className="size-3" />
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex">
        {/* Crop grid */}
        <div className="flex-1 relative p-4 bg-muted/40">
          <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-3">
            {MOCK_CROPS.map((c, i) => {
              const isActive = selected === i;
              const br = Math.max(0.05, Math.min(1, c.b + tpOffset * 0.008));
              return (
                <button
                  key={i}
                  title={`Crop #${i}`}
                  onClick={() => setSelected(isActive ? null : i)}
                  className={`aspect-square rounded-md border relative overflow-hidden transition-all duration-200 cursor-pointer ${
                    isActive
                      ? "ring-2 ring-foreground/30 border-foreground/25 scale-[1.03]"
                      : "border-foreground/10 hover:border-foreground/20 hover:scale-[1.06]"
                  }`}
                  style={{ background: "var(--background)" }}
                >
                  {/* Green gaussian cell pattern */}
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div
                      className="size-[72%] rounded-full"
                      style={{
                        background: `radial-gradient(circle, rgba(34,197,94,${br * 0.55}) 0%, rgba(22,163,74,${br * 0.2}) 40%, transparent 72%)`,
                        opacity: c.alive ? 1 : 0.3,
                        transition: "opacity 0.3s",
                      }}
                    />
                  </div>

                  {/* Red spots */}
                  {c.spots > 0 &&
                    SPOT_XY.slice(0, c.spots).map((_, si) => (
                      <div
                        key={si}
                        className="absolute size-[5px] rounded-full"
                        style={{
                          left: `${SPOT_XY[(si + i * 3) % SPOT_XY.length][0]}%`,
                          top: `${SPOT_XY[(si + i * 3) % SPOT_XY.length][1]}%`,
                          background: "radial-gradient(circle, rgba(239,68,68,0.9) 0%, rgba(239,68,68,0.3) 100%)",
                        }}
                      />
                    ))}

                  {/* Intensity bar */}
                  <div className="absolute bottom-0 inset-x-0 h-[3px] bg-white/[0.04]">
                    <div
                      className="h-full bg-white/20 transition-[width] duration-300"
                      style={{ width: `${br * 100}%` }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Detail panel */}
        <div
          className={`border-l bg-muted/40 overflow-hidden transition-all duration-300 ease-out ${
            sel ? "w-48 sm:w-52 opacity-100" : "w-0 opacity-0"
          }`}
        >
          {sel && selected !== null && (
            <div className="p-4 text-xs space-y-3 min-w-44">
              <div>
                <p className="text-muted-foreground/60 uppercase tracking-wider text-[9px] mb-0.5">
                  Selected
                </p>
                <p className="text-foreground font-medium">Crop #{selected}</p>
              </div>
              <div className="h-px bg-foreground/[0.1]" />
              <div className="space-y-1.5">
                {([
                  ["intensity", sel.int + tpOffset * 3],
                  ["area", `${sel.area} px\u00B2`],
                  ["spots", sel.spots],
                  ["background", Math.round(42 + tpOffset * 0.8)],
                ] as const).map(([label, val]) => (
                  <div key={label} className="flex justify-between">
                    <span className="text-muted-foreground/70">{label}</span>
                    <span className="text-foreground/90 tabular-nums">{val}</span>
                  </div>
                ))}
                <div className="flex justify-between">
                  <span className="text-muted-foreground/70">status</span>
                  <span className={sel.alive ? "text-foreground/90" : "text-foreground/50"}>
                    {sel.alive ? "alive" : "dead"}
                  </span>
                </div>
              </div>
              <div className="h-px bg-foreground/[0.1]" />
              <div>
                <p className="text-muted-foreground/60 uppercase tracking-wider text-[9px] mb-1">
                  Intensity
                </p>
                <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-foreground/20 transition-[width] duration-300"
                    style={{ width: `${Math.min(100, ((sel.int + tpOffset * 3) / 1500) * 100)}%` }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Status bar */}
      <div className="flex gap-4 px-4 py-2 text-[10px] text-muted-foreground/70 border-t bg-muted/50">
        <span>{MOCK_CROPS.length} crops</span>
        <span className="text-muted-foreground/35">·</span>
        <span>{MOCK_CROPS.filter((c) => c.alive).length} alive</span>
        <span className="text-muted-foreground/35">·</span>
        <span>{MOCK_CROPS.filter((c) => !c.alive).length} dead</span>
        <span className="text-muted-foreground/35">·</span>
        <span>{MOCK_CROPS.filter((c) => c.spots > 0).length} with spots</span>
      </div>
    </div>
  );
}

/* ── Main component ────────────────────────────────── */

export default function LandingPage() {
  const { theme } = useTheme();
  const [heroReady, setHeroReady] = useState(false);
  const [navVisible, setNavVisible] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setHeroReady(true), 100);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const onScroll = () => setNavVisible(window.scrollY > window.innerHeight * 0.7);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const heroClass = () =>
    `${heroReady ? "animate-hero-fade" : "opacity-0"}`;

  return (
    <div className="scroll-smooth">
      {/* ── Floating nav ─────────────────────────────── */}
      {navVisible && (
        <nav className="fixed top-0 inset-x-0 z-50 animate-slide-down">
          <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between backdrop-blur-md bg-background/80 border-b">
            <span
              className="font-medium text-lg"
              style={{ fontFamily: '"Bitcount", monospace' }}
            >
              MuPattern
            </span>
            <div className="flex items-center gap-6">
              <a
                href="#features"
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Features
              </a>
              <a
                href="#pipeline"
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                How it works
              </a>
              <a
                href="https://github.com/SoftmatterLMU-RaedlerGroup/mupattern"
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <Github className="size-4" />
              </a>
              <ThemeToggle />
            </div>
          </div>
        </nav>
      )}

      {/* ── Hero ─────────────────────────────────────── */}
      <section className="relative min-h-[100dvh] flex flex-col items-center justify-center overflow-hidden">
        <HexBackground theme={theme} />


        {/* Theme toggle (before nav appears) */}
        {!navVisible && (
          <div className="absolute top-4 right-4 z-10">
            <ThemeToggle />
          </div>
        )}

        {/* Content */}
        <div className="relative z-10 flex flex-col items-center px-6 max-w-4xl w-full">
          <h1
            className={`text-7xl md:text-8xl lg:text-[10rem] font-normal tracking-tighter leading-none mb-6 ${heroReady ? "animate-hero-title" : "opacity-0"}`}
            style={{ fontFamily: '"Bitcount", monospace' }}
          >
            MuPattern
          </h1>

          <p
            className={`text-xl md:text-2xl text-muted-foreground mb-3 text-center ${heroClass()}`}
            style={{ animationDelay: "300ms" }}
          >
            Microscopy micropattern analysis, automated.
          </p>

          <p
            className={`text-base text-muted-foreground/70 max-w-lg mx-auto mb-8 text-center ${heroClass()}`}
            style={{ animationDelay: "500ms" }}
          >
            From TIFF stacks to quantified results. Crop, analyze, and export
            — all in a single workflow.
          </p>

          <div
            className={`flex gap-4 justify-center mb-14 ${heroClass()}`}
            style={{ animationDelay: "700ms" }}
          >
            <a href="/download">
              <Button variant="outline" size="lg" className="gap-2">
                <Download className="size-4" />
                Get Desktop App
              </Button>
            </a>
            <a href="/tools">
              <Button variant="outline" size="lg" className="gap-2">
                <Globe className="size-4" />
                Open Web Tools
              </Button>
            </a>
          </div>

        </div>

        {/* Scroll indicator */}
        <a
          href="#features"
          className={`absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 text-muted-foreground/40 hover:text-muted-foreground transition-colors ${heroClass()}`}
          style={{ animationDelay: "1200ms" }}
        >
          <span className="text-[10px] uppercase tracking-[0.2em]">Scroll</span>
          <ArrowDown className="size-4 animate-bounce-soft" />
        </a>
      </section>

      {/* ── Features ─────────────────────────────────── */}
      <section id="features" className="py-28 px-6">
        <div className="max-w-6xl mx-auto">
          <Reveal className="text-center mb-16">
            <h2
              className="text-4xl md:text-5xl font-normal tracking-tight mb-4"
              style={{ fontFamily: '"Bitcount", monospace' }}
            >
              Everything you need
            </h2>
            <p className="text-lg text-muted-foreground max-w-xl mx-auto">
              A complete toolkit for micropattern microscopy, from file
              conversion to quantitative analysis.
            </p>
          </Reveal>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map((f, i) => (
              <FeatureCard
                key={f.title}
                icon={f.icon}
                title={f.title}
                desc={f.desc}
                delay={i * 100}
              />
            ))}
          </div>
        </div>
      </section>

      {/* ── Tech marquee ─────────────────────────────── */}
      <div className="overflow-hidden border-y py-5" aria-hidden>
        <div className="flex gap-12 w-max animate-marquee whitespace-nowrap">
          {[...TECH, ...TECH, ...TECH, ...TECH].map((t, i) => (
            <span
              key={i}
              className="text-sm text-muted-foreground/40 uppercase tracking-widest"
            >
              {t}
            </span>
          ))}
        </div>
      </div>

      {/* ── Pipeline ─────────────────────────────────── */}
      <section id="pipeline" className="py-28 px-6 bg-muted/20">
        <div className="max-w-3xl mx-auto">
          <Reveal className="text-center mb-16">
            <h2
              className="text-4xl md:text-5xl font-normal tracking-tight mb-4"
              style={{ fontFamily: '"Bitcount", monospace' }}
            >
              How it works
            </h2>
            <p className="text-lg text-muted-foreground">
              Four steps from raw data to publication-ready results.
            </p>
          </Reveal>

          <div>
            {PIPELINE.map((s, i) => (
              <PipelineStep
                key={s.n}
                n={s.n}
                title={s.title}
                desc={s.desc}
                delay={i * 150}
                isLast={i === PIPELINE.length - 1}
              />
            ))}
          </div>
        </div>
      </section>

      {/* ── Format marquee ────────────────────────────── */}
      <div className="overflow-hidden border-y py-5" aria-hidden>
        <div className="flex gap-12 w-max animate-marquee whitespace-nowrap">
          {[...["TIFF", "Zarr v3", "CSV", "ONNX", "ND2", "Multi-Position", "Time-Lapse", "Multi-Channel"], ...["TIFF", "Zarr v3", "CSV", "ONNX", "ND2", "Multi-Position", "Time-Lapse", "Multi-Channel"], ...["TIFF", "Zarr v3", "CSV", "ONNX", "ND2", "Multi-Position", "Time-Lapse", "Multi-Channel"], ...["TIFF", "Zarr v3", "CSV", "ONNX", "ND2", "Multi-Position", "Time-Lapse", "Multi-Channel"]].map((t, i) => (
            <span
              key={i}
              className="text-sm text-muted-foreground/40 uppercase tracking-widest"
            >
              {t}
            </span>
          ))}
        </div>
      </div>

      {/* ── Preview ──────────────────────────────────── */}
      <section className="py-28 px-6">
        <div className="max-w-5xl mx-auto">
          <Reveal className="text-center mb-12">
            <h2
              className="text-4xl md:text-5xl font-normal tracking-tight mb-4"
              style={{ fontFamily: '"Bitcount", monospace' }}
            >
              See it in action
            </h2>
            <p className="text-lg text-muted-foreground">
              Browse and analyze micropattern crops, right from your desktop.
            </p>
          </Reveal>
          <Reveal delay={150}>
            <MockWindow />
          </Reveal>
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────── */}
      <section className="py-28 px-6 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-foreground/[0.02] via-transparent to-foreground/[0.02]" />
        <Reveal className="relative z-10 text-center max-w-2xl mx-auto">
          <h2
            className="text-4xl md:text-5xl font-normal tracking-tight mb-4"
            style={{ fontFamily: '"Bitcount", monospace' }}
          >
            Ready to analyze?
          </h2>
          <p className="text-lg text-muted-foreground mb-8">
            Download the desktop app for maximum performance, or try the web
            tools in your browser.
          </p>
          <div className="flex gap-4 justify-center flex-wrap">
            <a href="/download">
              <Button variant="outline" size="lg" className="gap-2">
                <Download className="size-4" />
                Get Desktop App
              </Button>
            </a>
            <a href="/tools">
              <Button variant="outline" size="lg" className="gap-2">
                <Globe className="size-4" />
                Open Web Tools
              </Button>
            </a>
          </div>
        </Reveal>
      </section>

      {/* ── Footer ────────────────────────────────────── */}
      <footer className="py-8 px-6 border-t">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <span
            className="text-sm text-muted-foreground"
            style={{ fontFamily: '"Bitcount", monospace' }}
          >
            MuPattern
          </span>
          <div className="flex items-center gap-4">
            <span className="text-xs text-muted-foreground/60">
              Built for microscopy researchers
            </span>
            <a
              href="https://github.com/SoftmatterLMU-RaedlerGroup/mupattern"
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground/60 hover:text-foreground transition-colors"
            >
              <Github className="size-3.5" />
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
