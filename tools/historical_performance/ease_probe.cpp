// SPDX-License-Identifier: GPL-3.0-only
// MuseScore-Studio-CLA-applies
// Standalone regression probe for the upstream MPE curve evaluator.
// Build from the repository root with:
// g++ -std=c++20 -I muse/framework -I muse/framework/global -I muse/framework/thirdparty tools/historical_performance/ease_probe.cpp -o build/ease_probe
#include "mpe/automationpoint.h"

#include <cassert>
#include <cmath>
#include <iostream>

int main()
{
    using muse::mpe::AutomationPoint;
    auto at = [](AutomationPoint::Ease ease, double position) {
        AutomationPoint point;
        point.outValue = 1.0;
        point.inValue = AutomationPoint::ExplicitArrival { 1.0, ease };
        return muse::mpe::evaluateAt(point, muse::real_t(0.0), muse::real_t(position)).raw();
    };

    const auto normal = AutomationPoint::Ease::none();
    const AutomationPoint::Ease easeIn { muse::real_t::make(0.5), muse::real_t::make(0.25) };
    const AutomationPoint::Ease easeOut { muse::real_t::make(0.5), muse::real_t::make(0.75) };
    for (const auto ease : { normal, easeIn, easeOut }) {
        assert(std::abs(at(ease, 0.0)) < 0.000001);
        assert(std::abs(at(ease, 1.0) - 1.0) < 0.000001);
    }
    assert(std::abs(at(normal, 0.5) - 0.5) < 0.000001);
    assert(std::abs(at(easeIn, 0.5) - 0.25) < 0.000001);
    assert(std::abs(at(easeOut, 0.5) - 0.75) < 0.000001);
    std::cout << "MPE ease probe: normal 0.5, ease-in 0.25, ease-out 0.75 at midpoint\n";
}
