/*
 * SPDX-License-Identifier: GPL-3.0-only
 * MuseScore-Studio-CLA-applies
 *
 * MuseScore Studio
 * Music Composition & Notation
 *
 * Copyright (C) 2021 MuseScore Limited and others
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3 as
 * published by the Free Software Foundation.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */
import QtQuick

import Muse.Ui
import Muse.UiComponents
import MuseScore.PropertiesPanel

import "../../../common"

FocusableItem {
    id: root

    required property HairpinLineSettingsModel model

    property NavigationPanel navigationPanel: null
    property int navigationRowStart: 1

    implicitHeight: contentColumn.height
    width: parent.width

    Column {
        id: contentColumn

        width: parent.width

        spacing: 12

        VoicesAndPositionSection {
            id: voicesAndPositionSection

            navigationPanel: root.navigationPanel
            navigationRowStart: root.navigationRowStart

            model: root.model
        }

        SeparatorLine{
            anchors.margins: -12
        }

        StyledTextLabel {
            text: qsTrc("propertiespanel", "Alignment with adjacent dynamics")
        }

        PropertyCheckBox {
            id: snapBefore
            text: qsTrc("propertiespanel", "Snap to previous")
            propertyItem: root.model ? root.model.snapBefore : null

            navigation.panel: root.navigationPanel
            navigation.row: voicesAndPositionSection.navigationRowEnd + 1
        }

        PropertyCheckBox {
            id: snapAfter
            text: qsTrc("propertiespanel", "Snap to next")
            propertyItem: root.model ? root.model.snapAfter : null

            navigation.panel: root.navigationPanel
            navigation.row: snapBefore.navigation.row + 1
        }

        SpinBoxPropertyView {
            titleText: qsTrc("propertiespanel", "Dynamic change (0 = automatic)")
            propertyItem: root.model ? root.model.velocityChange : null
            minValue: 0
            maxValue: 127
            step: 1
            decimals: 0
            navigationName: "Dynamic change"
            navigationPanel: root.navigationPanel
            navigationRowStart: snapAfter.navigation.row + 1
        }

        StyledTextLabel {
            width: parent.width
            text: qsTrc("propertiespanel", "A nonzero change overrides a snapped ending dynamic during the span; 0 uses the ending dynamic, or a small automatic change if none is present. Adjust the span and listen to the instrument.")
        }
    }
}
