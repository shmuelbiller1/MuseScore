/*
 * SPDX-License-Identifier: GPL-3.0-only
 * MuseScore-Studio-CLA-applies
 *
 * MuseScore Studio
 * Music Composition & Notation
 *
 * Copyright (C) 2026 MuseScore Limited and others
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3 as
 * published by the Free Software Foundation.
 */
#pragma once

#include <algorithm>
#include <cmath>
#include <stdexcept>
#include <vector>

// Offline, deterministic period-synchronous overlap-add. This is deliberately
// not advertised as a natural voice model. The output period is controlled by
// the written/explicit target pitch; source periods remain at their sample rate.
namespace mu::notation::voice {
inline double estimatePitch(const std::vector<float>& source, int rate, int begin, int end)
{
    if (rate < 8000 || begin < 0 || end > int(source.size()) || end - begin < rate * 0.03) {
        throw std::runtime_error("Select at least 30 ms of a voiced recording");
    }
    const int length = std::min(int(rate * 0.09), end - begin);
    const int firstLag = std::max(2, rate / 900);
    const int lastLag = std::min(rate / 65, length / 2);
    double energy = 0;
    for (int i = begin; i < begin + length; ++i) {
        energy += source[i] * source[i];
    }
    if (energy / length < 1e-6) {
        throw std::runtime_error("The chosen source slice is silent");
    }
    std::vector<double> scores(lastLag + 2, 0);
    double bestScore = -1;
    int best = firstLag;
    for (int lag = firstLag; lag <= lastLag; ++lag) {
        double dot = 0, aa = 0, bb = 0;
        for (int i = begin; i < begin + length - lag; ++i) {
            const double a = source[i], b = source[i + lag];
            dot += a * b;
            aa += a * a;
            bb += b * b;
        }
        scores[lag] = dot / std::sqrt(aa * bb + 1e-20);
        if (scores[lag] > bestScore) {
            bestScore = scores[lag];
            best = lag;
        }
    }
    if (bestScore < 0.55) {
        throw std::runtime_error("No reliable source pitch; select a sustained vowel");
    }
    for (int lag = firstLag + 1; lag < lastLag; ++lag) {
        if (scores[lag] >= 0.75 && scores[lag] >= bestScore * 0.88
            && scores[lag] >= scores[lag - 1] && scores[lag] >= scores[lag + 1]) {
            best = lag;
            break;
        }
    }
    double offset = 0;
    if (best > firstLag && best < lastLag) {
        const double left = scores[best - 1], center = scores[best], right = scores[best + 1];
        const double curve = left - 2 * center + right;
        if (curve < -1e-6) {
            offset = std::clamp(0.5 * (left - right) / curve, -0.5, 0.5);
        }
    }
    return rate / (best + offset);
}

inline std::vector<int> findEpochs(const std::vector<float>& source, int rate, double sourceHz, int begin, int end)
{
    const double period = rate / sourceHz;
    if (end - begin < 5 * period) {
        throw std::runtime_error("Select at least five periods of a voiced vowel");
    }
    const int margin = int(std::ceil(period * 1.5));
    const int radius = std::max(2, int(period * 0.4));
    const int search = std::max(2, int(period * 0.2));
    int first = begin + margin;
    for (int at = first + 1; at < std::min(end - margin, first + int(period)); ++at) {
        if (std::abs(source[at]) > std::abs(source[first])) {
            first = at;
        }
    }
    std::vector<int> epochs { first };
    int last = first;
    while (last + period + search < end - margin) {
        const int predicted = int(std::round(last + period));
        int best = predicted;
        double bestScore = -1;
        for (int candidate = predicted - search; candidate <= predicted + search; ++candidate) {
            double dot = 0, aa = 0, bb = 0;
            for (int j = -radius; j <= radius; ++j) {
                const double a = source[last + j], b = source[candidate + j];
                dot += a * b;
                aa += a * a;
                bb += b * b;
            }
            const double score = dot / std::sqrt(aa * bb + 1e-20) - 0.0002 * std::abs(candidate - predicted);
            if (score > bestScore) {
                bestScore = score;
                best = candidate;
            }
        }
        if (bestScore < 0.2 || best <= last) {
            break;
        }
        epochs.push_back(best);
        last = best;
    }
    return epochs;
}

struct SourcePlan
{
    int begin = 0;
    int end = 0;
    int attack = 0;
    int release = 0;
    int coreBegin = 0;
    int coreEnd = 0;
    double sourceHz = 0;
    std::vector<int> epochs;
};

inline SourcePlan prepare(const std::vector<float>& source, int rate, int begin, int end)
{
    if (rate < 8000 || begin < 0 || end > int(source.size()) || end <= begin) {
        throw std::runtime_error("Invalid source slice");
    }
    SourcePlan plan;
    plan.begin = begin;
    plan.end = end;
    plan.attack = std::min(int(rate * 0.035), int((end - begin) * 0.14));
    plan.release = std::min(int(rate * 0.025), int((end - begin) * 0.10));
    plan.coreBegin = begin + plan.attack;
    plan.coreEnd = end - plan.release;
    plan.sourceHz = estimatePitch(source, rate, plan.coreBegin, plan.coreEnd);
    if (plan.sourceHz < 65 || plan.sourceHz > 900 || plan.coreEnd - plan.coreBegin < 5 * rate / plan.sourceHz) {
        throw std::runtime_error("The tagged vowel is too short or outside the supported voice range");
    }
    plan.epochs = findEpochs(source, rate, plan.sourceHz, plan.coreBegin, plan.coreEnd);
    return plan;
}

inline std::vector<float> synthesize(const std::vector<float>& source, int rate, const SourcePlan& plan,
                                     double targetHz, int frames)
{
    if (frames <= 0 || frames > rate * 240 || targetHz < 50 || targetHz > 1400) {
        throw std::runtime_error("Invalid output pitch or length");
    }
    const int begin = plan.begin, end = plan.end;
    const int attack = plan.attack, release = plan.release;
    const int coreBegin = plan.coreBegin, coreEnd = plan.coreEnd;
    const double sourceHz = plan.sourceHz;
    const auto& epochs = plan.epochs;
    const double period = rate / sourceHz;
    const double spacing = rate / targetHz;
    const int grain = std::max(2, int(std::ceil(std::min(period, spacing * 0.52))));
    std::vector<float> output(frames, 0), weights(frames, 0);
    const int attackFrames = std::min(attack, int(frames * 0.16));
    const int releaseFrames = std::min(release, int(frames * 0.12));
    const int overlap = std::min({ int(rate * 0.006), attackFrames / 2, releaseFrames / 2 });
    const int coreStart = attackFrames - overlap;
    const int coreStop = frames - releaseFrames + overlap;
    const int count = int(std::ceil((coreStop - coreStart + grain) / spacing));
    int epochNumber = 0;
    for (double center = coreStart; center < coreStop + grain; center += spacing, ++epochNumber) {
        const int epochIndex = std::min(int(epochs.size()) - 1, int(double(epochNumber) * epochs.size() / std::max(1, count)));
        const int input = epochs[epochIndex];
        for (int j = -grain; j <= grain; ++j) {
            const int at = int(std::round(center + j));
            if (at < coreStart || at >= coreStop || input + j < coreBegin || input + j >= coreEnd) {
                continue;
            }
            const float window = float(0.5 + 0.5 * std::cos(3.141592653589793 * j / grain));
            output[at] += source[input + j] * window;
            weights[at] += window;
        }
    }
    for (int i = coreStart; i < coreStop; ++i) {
        output[i] = weights[i] ? output[i] / weights[i] : 0;
    }
    for (int i = 0; i < attackFrames; ++i) {
        const int at = begin + i * attack / std::max(1, attackFrames);
        const float blend = i < coreStart ? 0 : float(i - coreStart + 1) / (overlap + 1);
        output[i] = source[at] * (1 - blend) + output[i] * blend;
    }
    for (int i = frames - releaseFrames; i < frames; ++i) {
        const int at = coreEnd + (i - (frames - releaseFrames)) * release / std::max(1, releaseFrames);
        const float blend = i < frames - releaseFrames + overlap
                            ? float(i - (frames - releaseFrames) + 1) / (overlap + 1) : 1;
        output[i] = output[i] * (1 - blend) + source[std::min(end - 1, at)] * blend;
    }
    const int fade = std::max(1, int(rate * 0.012));
    for (int i = 0; i < frames; ++i) {
        output[i] *= std::min({ 1.0f, float(i + 1) / fade, float(frames - i) / fade });
    }
    return output;
}

inline std::vector<float> synthesize(const std::vector<float>& source, int rate, int begin, int end, double targetHz, int frames)
{
    return synthesize(source, rate, prepare(source, rate, begin, end), targetHz, frames);
}
}
