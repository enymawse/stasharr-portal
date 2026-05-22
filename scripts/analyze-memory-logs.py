#!/usr/bin/env python3
from __future__ import annotations

import math
import re
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Iterable


MEMORY_PATTERN = re.compile(
    r"\[(?P<job>[^\]]+)] outcome=(?P<outcome>\S+)"
    r"(?: durationMs=(?P<duration_ms>\d+))?"
    r" rss=(?P<rss>\d+)MB"
    r" heap=(?P<heap_used>\d+)\/(?P<heap_total>\d+)MB"
    r" external=(?P<external>\d+)MB"
    r" arrayBuffers=(?P<array_buffers>\d+)MB"
)
DOCKER_ISO_PATTERN = re.compile(r"^(?P<timestamp>\d{4}-\d{2}-\d{2}T\S+)")
ANSI_PATTERN = re.compile(r"\x1b\[[0-9;]*m")
SIGNAL_PATTERN = re.compile(
    r"Background indexing job failed|"
    r"Skipping overlapping indexing job|"
    r"Metadata hydration batch failed|"
    r"outcome=failed|"
    r"fetch failed|"
    r"provider returned|"
    r"AbortError|"
    r"Failed to reach",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class Sample:
    line_number: int
    timestamp: datetime | None
    job: str
    outcome: str
    duration_ms: int | None
    rss_mb: int
    heap_used_mb: int
    heap_total_mb: int
    external_mb: int
    array_buffers_mb: int
    raw: str


@dataclass
class JobStats:
    samples: int = 0
    failed: int = 0
    skipped: int = 0
    min_rss: int = sys.maxsize
    max_rss: int = -sys.maxsize
    first_rss: int | None = None
    last_rss: int | None = None
    duration_count: int = 0
    duration_total_ms: int = 0
    max_duration_ms: int = 0
    total_rss_delta_after_run: int = 0
    positive_rss_delta_after_run: int = 0
    rss_delta_samples: int = 0


def usage() -> None:
    print(
        """Usage:
  python3 scripts/analyze-memory-logs.py <app.log>
  docker logs --timestamps <container> 2>&1 | python3 scripts/analyze-memory-logs.py -

Expected telemetry lines look like:
  [metadata-backfill] outcome=completed durationMs=42 rss=341MB heap=80/120MB external=3MB arrayBuffers=1MB"""
    )


def read_input() -> str:
    arg = sys.argv[1] if len(sys.argv) > 1 else "-"
    if arg in {"--help", "-h"}:
        usage()
        raise SystemExit(0)
    if arg == "-":
        return sys.stdin.read()
    return Path(arg).read_text(encoding="utf-8")


def parse_timestamp(line: str) -> datetime | None:
    match = DOCKER_ISO_PATTERN.search(line)
    if not match:
        return None

    raw = match.group("timestamp")
    # Docker timestamps commonly end with Z. Python wants an explicit UTC offset.
    if raw.endswith("Z"):
        raw = f"{raw[:-1]}+00:00"

    try:
        return datetime.fromisoformat(raw)
    except ValueError:
        return None


def parse_memory_sample(line: str, line_number: int) -> Sample | None:
    clean_line = ANSI_PATTERN.sub("", line)
    match = MEMORY_PATTERN.search(clean_line)
    if not match:
        return None

    groups = match.groupdict()
    return Sample(
        line_number=line_number,
        timestamp=parse_timestamp(clean_line),
        job=groups["job"],
        outcome=groups["outcome"],
        duration_ms=(
            int(groups["duration_ms"])
            if groups.get("duration_ms") is not None
            else None
        ),
        rss_mb=int(groups["rss"]),
        heap_used_mb=int(groups["heap_used"]),
        heap_total_mb=int(groups["heap_total"]),
        external_mb=int(groups["external"]),
        array_buffers_mb=int(groups["array_buffers"]),
        raw=clean_line,
    )


def format_mb(value: int | float | None) -> str:
    if value is None:
        return "n/a"
    return f"{round(value)}MB"


def format_signed_mb(value: int | float) -> str:
    rounded = round(value)
    return f"{'+' if rounded >= 0 else ''}{rounded}MB"


def format_number(value: int | float | None, digits: int = 1) -> str:
    if value is None or not math.isfinite(value):
        return "n/a"
    return f"{value:.{digits}f}"


def format_sample_time(sample: Sample) -> str:
    if sample.timestamp is not None:
        return sample.timestamp.isoformat()
    return f"line {sample.line_number}"


def summarize_series(samples: list[Sample]) -> dict[str, object]:
    first = samples[0]
    last = samples[-1]
    min_rss = min(sample.rss_mb for sample in samples)
    max_rss = max(sample.rss_mb for sample in samples)
    max_heap = max(sample.heap_used_mb for sample in samples)
    rss_delta = last.rss_mb - first.rss_mb

    elapsed_hours: float | None = None
    if first.timestamp is not None and last.timestamp is not None:
        elapsed_seconds = (last.timestamp - first.timestamp).total_seconds()
        if elapsed_seconds > 0:
            elapsed_hours = elapsed_seconds / 60 / 60

    rss_rate_per_hour = (
        rss_delta / elapsed_hours if elapsed_hours is not None else None
    )

    return {
        "first": first,
        "last": last,
        "min_rss": min_rss,
        "max_rss": max_rss,
        "max_heap": max_heap,
        "rss_delta": rss_delta,
        "elapsed_hours": elapsed_hours,
        "rss_rate_per_hour": rss_rate_per_hour,
    }


def build_job_summaries(samples: list[Sample]) -> list[tuple[str, JobStats]]:
    by_job: dict[str, JobStats] = {}

    for index, sample in enumerate(samples):
        stats = by_job.setdefault(sample.job, JobStats())
        stats.samples += 1
        stats.failed += 1 if sample.outcome == "failed" else 0
        stats.skipped += 1 if sample.outcome.startswith("skipped") else 0
        stats.min_rss = min(stats.min_rss, sample.rss_mb)
        stats.max_rss = max(stats.max_rss, sample.rss_mb)
        if stats.first_rss is None:
            stats.first_rss = sample.rss_mb
        stats.last_rss = sample.rss_mb

        if sample.duration_ms is not None:
            stats.duration_count += 1
            stats.duration_total_ms += sample.duration_ms
            stats.max_duration_ms = max(stats.max_duration_ms, sample.duration_ms)

        if index > 0:
            previous = samples[index - 1]
            delta = sample.rss_mb - previous.rss_mb
            stats.total_rss_delta_after_run += delta
            stats.positive_rss_delta_after_run += max(delta, 0)
            stats.rss_delta_samples += 1

    return sorted(
        by_job.items(),
        key=lambda item: (-item[1].positive_rss_delta_after_run, -item[1].samples),
    )


def collect_signals(lines: Iterable[str]) -> list[tuple[int, str]]:
    signals: list[tuple[int, str]] = []
    for line_number, line in enumerate(lines, start=1):
        clean_line = ANSI_PATTERN.sub("", line)
        if SIGNAL_PATTERN.search(clean_line):
            signals.append((line_number, clean_line))
    return signals


def print_job_summaries(job_summaries: list[tuple[str, JobStats]]) -> None:
    print("\nPer-job memory correlation")
    print(
        "job | samples | failed | skipped | rss min/max | first->last | "
        "avg duration | max duration | positive rss delta"
    )
    print("-" * 120)

    for job, stats in job_summaries:
        avg_duration = (
            stats.duration_total_ms / stats.duration_count
            if stats.duration_count > 0
            else None
        )
        first_rss = stats.first_rss or 0
        last_rss = stats.last_rss or 0
        print(
            " | ".join(
                [
                    job,
                    str(stats.samples),
                    str(stats.failed),
                    str(stats.skipped),
                    f"{format_mb(stats.min_rss)}/{format_mb(stats.max_rss)}",
                    (
                        f"{format_mb(first_rss)}->{format_mb(last_rss)} "
                        f"({format_signed_mb(last_rss - first_rss)})"
                    ),
                    "n/a"
                    if avg_duration is None
                    else f"{format_number(avg_duration, 0)}ms",
                    f"{stats.max_duration_ms}ms" if stats.max_duration_ms else "n/a",
                    format_signed_mb(stats.positive_rss_delta_after_run),
                ]
            )
        )


def print_signals(signals: list[tuple[int, str]]) -> None:
    print("\nNotable failure/overlap/provider signals")
    if not signals:
        print("none found")
        return

    for line_number, text in signals[:40]:
        print(f"line {line_number}: {text[:240]}")

    if len(signals) > 40:
        print(f"... {len(signals) - 40} more signal lines omitted")


def main() -> None:
    input_text = read_input()
    lines = input_text.splitlines()
    samples = [
        sample
        for line_number, line in enumerate(lines, start=1)
        if (sample := parse_memory_sample(line, line_number)) is not None
    ]

    if not samples:
        print("No scheduler memory telemetry lines were found.", file=sys.stderr)
        print(
            "Make sure the container was started with "
            "STASHARR_INDEXING_MEMORY_LOG=1 and pass docker logs output to this script.",
            file=sys.stderr,
        )
        raise SystemExit(1)

    summary = summarize_series(samples)
    first = summary["first"]
    last = summary["last"]
    assert isinstance(first, Sample)
    assert isinstance(last, Sample)
    timestamped_samples = sum(1 for sample in samples if sample.timestamp is not None)
    failed_samples = [sample for sample in samples if sample.outcome == "failed"]
    skipped_samples = [
        sample for sample in samples if sample.outcome.startswith("skipped")
    ]

    print("Scheduler memory telemetry summary")
    print("==================================")
    print(f"samples: {len(samples)}")
    print(f"timestamped samples: {timestamped_samples}/{len(samples)}")
    print(f"window: {format_sample_time(first)} -> {format_sample_time(last)}")

    elapsed_hours = summary["elapsed_hours"]
    if isinstance(elapsed_hours, float):
        print(f"elapsed: {format_number(elapsed_hours, 2)} hours")
    else:
        print("elapsed: n/a (run docker logs with --timestamps for rate)")

    print(
        f"rss: {format_mb(first.rss_mb)} -> {format_mb(last.rss_mb)} "
        f"({format_signed_mb(int(summary['rss_delta']))})"
    )
    print(
        f"rss min/max: {format_mb(int(summary['min_rss']))} / "
        f"{format_mb(int(summary['max_rss']))}"
    )
    print(f"max heap used: {format_mb(int(summary['max_heap']))}")

    rss_rate = summary["rss_rate_per_hour"]
    print(
        "rss rate: "
        + (
            "n/a"
            if rss_rate is None
            else f"{format_signed_mb(float(rss_rate))}/hour"
        )
    )
    print(f"failed telemetry samples: {len(failed_samples)}")
    print(f"skipped overlap samples: {len(skipped_samples)}")

    print_job_summaries(build_job_summaries(samples))
    print_signals(collect_signals(lines))


if __name__ == "__main__":
    main()
