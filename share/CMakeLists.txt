# SPDX-License-Identifier: GPL-3.0-only
# MuseScore-Studio-CLA-applies
#
# MuseScore Studio
# Music Composition & Notation
#
# Copyright (C) 2021 MuseScore Limited and others
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License version 3 as
# published by the Free Software Foundation.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program.  If not, see <https://www.gnu.org/licenses/>.

subdirs(testflowscripts icons templates wallpapers locale styles sound manual instruments)

install (DIRECTORY
    plugins
    DESTINATION ${MUSE_APP_INSTALL_RESOURCES_LOCATION}
    PATTERN ".*" EXCLUDE
    )

install (DIRECTORY
    extensions
    DESTINATION ${MUSE_APP_INSTALL_RESOURCES_LOCATION}
    PATTERN ".*" EXCLUDE
    )

install (DIRECTORY
    workspaces
    DESTINATION ${MUSE_APP_INSTALL_RESOURCES_LOCATION}
    PATTERN ".*" EXCLUDE
    )

# Offline experimental choir sidecar: open choir-studio/index.html in a
# browser after exporting MIDI from the score. No runtime downloads or models.
install (DIRECTORY
    choir-studio
    DESTINATION ${MUSE_APP_INSTALL_RESOURCES_LOCATION}
    PATTERN "tests" EXCLUDE
    PATTERN "generate.cjs" EXCLUDE
    PATTERN ".*" EXCLUDE
    )
