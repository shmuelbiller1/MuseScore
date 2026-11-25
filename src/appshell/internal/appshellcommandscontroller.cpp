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
#include "appshellcommandscontroller.h"

#include <QApplication>
#include <QCloseEvent>
#include <QDragEnterEvent>
#include <QDragMoveEvent>
#include <QDropEvent>
#include <QFileOpenEvent>
#include <QFile>
#include <QFileInfo>
#include <QDir>
#include <QUrl>
#include <QWindow>
#include <vector>
#include <QMimeData>

#include "global/async/async.h"
#include "global/types/ret.h"
#include "global/translation.h"
#include "global/containers.h"

#include "audio/common/soundfonttypes.h"
#include "project/inotationproject.h"

#include "../appshellcommands.h"
#include "project/projectcommands.h"
#include "playback/playbackcommands.h"

#include "log.h"

using namespace muse;
using namespace mu::appshell;
using namespace mu::playback;

static const std::map<rcommand::Command, DockName> s_dockToggleCommands = {
    { DOCK_TOGGLE_PLAYBACK_COMMAND, PLAYBACK_TOOLBAR_NAME },
    { DOCK_TOGGLE_NOTEINPUT_COMMAND, NOTE_INPUT_BAR_NAME },
    { DOCK_TOGGLE_PALETTES_COMMAND, PALETTES_PANEL_NAME },
    { DOCK_TOGGLE_INSTRUMENTS_COMMAND, LAYOUT_PANEL_NAME },
    { DOCK_TOGGLE_PROPERTIES_COMMAND, PROPERTIES_PANEL_NAME },
    { DOCK_TOGGLE_SELECTION_FILTER_COMMAND, SELECTION_FILTERS_PANEL_NAME },
    { DOCK_TOGGLE_UNDO_HISTORY_COMMAND, UNDO_HISTORY_PANEL_NAME },
    { DOCK_TOGGLE_NAVIGATOR_COMMAND, NOTATION_NAVIGATOR_PANEL_NAME },
    { DOCK_TOGGLE_BRAILLE_COMMAND, NOTATION_BRAILLE_PANEL_NAME },
    { DOCK_TOGGLE_TIMELINE_COMMAND, TIMELINE_PANEL_NAME },
    { DOCK_TOGGLE_MIXER_COMMAND, MIXER_PANEL_NAME },
    { DOCK_TOGGLE_PIANO_KEYBOARD_COMMAND, PIANO_KEYBOARD_PANEL_NAME },
    { DOCK_TOGGLE_PERCUSSION_COMMAND, PERCUSSION_PANEL_NAME },
    { DOCK_TOGGLE_STATUSBAR_COMMAND, NOTATION_STATUSBAR_NAME },
};

void AppshellCommandsController::preInit()
{
    qApp->installEventFilter(this);
}

void AppshellCommandsController::init()
{
    auto cd = commandDispatcher();
    cd->onRequest(this, APP_QUIT_COMMAND, [this](const rcommand::Params& params) { return quit(params); });
    cd->onRequest(this, APP_RESTART_COMMAND, [this]() { restart(); return muse::make_ok(); });
    cd->onRequest(this, APP_FULLSCREEN_COMMAND, [this]() { toggleFullScreen(); return muse::make_ok(); });

    cd->onRequest(this, APP_ABOUT_MUSESCORE_COMMAND, [this]() { openAboutDialog(); return muse::make_ok(); });
    cd->onRequest(this, APP_ABOUT_QT_COMMAND, [this]() { openAboutQtDialog(); return muse::make_ok(); });
    cd->onRequest(this, APP_ABOUT_MUSICXML_COMMAND, [this]() { openAboutMusicXMLDialog(); return muse::make_ok(); });
    cd->onRequest(this, APP_ONLINE_HANDBOOK_COMMAND, [this]() { openOnlineHandbookPage(); return muse::make_ok(); });
    cd->onRequest(this, APP_EXPERIMENTAL_CHOIR_COMMAND, [this]() { openExperimentalChoirPage(); return muse::make_ok(); });
    cd->onRequest(this, APP_CREATE_EDITABLE_SCORE_COPY_COMMAND, [this]() { createEditableScoreCopy(); return muse::make_ok(); });
    cd->onRequest(this, APP_ASK_HELP_COMMAND, [this]() { openAskForHelpPage(); return muse::make_ok(); });

    cd->onRequest(this, APP_ACCESSIBILITY_STATEMENT_COMMAND, [this]() { openAccessibilityStatementPage(); return muse::make_ok(); });
    cd->onRequest(this, APP_PREFERENCES_COMMAND, [this]() { openPreferencesDialog(); return muse::make_ok(); });
    cd->onRequest(this, APP_REVERT_TO_FACTORY_COMMAND, [this]() { revertToFactorySettings(); return muse::make_ok(); });
    cd->onRequest(this, APP_EXTENSIONS_COMMAND, [this]() { openExtensions(); return muse::make_ok(); });

    for (const auto& [command, dockName] : s_dockToggleCommands) {
        cd->onRequest(this, command, [this, dockName]() {
            m_dockToggleRequested.send(dockName);
            return muse::make_ok();
        });
    }
}

bool AppshellCommandsController::eventFilter(QObject* watched, QEvent* event)
{
    if ((event->type() == QEvent::Close && watched == qWindow())
        || event->type() == QEvent::Quit) {
        event->setAccepted(false);

        quit(false);

        return true;
    }

    if (watched == qApp) {
        if (event->type() == QEvent::FileOpen) {
            const QFileOpenEvent* openEvent = static_cast<const QFileOpenEvent*>(event);
            const QUrl url = openEvent->url();

            if (openProjectScenario()->isUrlSupported(url)) {
                if (startupScenario()->startupCompleted()) {
                    commandDispatcher()->dispatch(project::PROJECT_OPEN_COMMAND, { { "url", muse::Val(url.toString()) } });
                } else {
                    startupScenario()->setStartupScoreFile(project::ProjectFile { url });
                }

                return true;
            }
        }
    }

    if (watched == qWindow()) {
        if (event->type() == QEvent::DragEnter) {
            if (onDragEnterEvent(static_cast<QDragEnterEvent*>(event))) {
                return true;
            }
        } else if (event->type() == QEvent::DragMove) {
            if (onDragMoveEvent(static_cast<QDragMoveEvent*>(event))) {
                return true;
            }
        } else if (event->type() == QEvent::Drop) {
            if (onDropEvent(static_cast<QDropEvent*>(event))) {
                return true;
            }
        }
    }

    return QObject::eventFilter(watched, event);
}

muse::rcommand::Command AppshellCommandsController::dockToggleCommand(const DockName& dockName) const
{
    return muse::key(s_dockToggleCommands, dockName);
}

DockName AppshellCommandsController::commandDockName(const muse::rcommand::Command& command) const
{
    return muse::value(s_dockToggleCommands, command);
}

muse::async::Channel<DockName> AppshellCommandsController::dockToggleRequested() const
{
    return m_dockToggleRequested;
}

QWindow* AppshellCommandsController::qWindow() const
{
    return mainWindow() ? mainWindow()->qWindow() : nullptr;
}

AppshellCommandsController::DragTarget AppshellCommandsController::dragTarget(const QUrl& url) const
{
    if (openProjectScenario()->isUrlSupported(url)) {
        return DragTarget::ProjectFile;
    } else if (url.isLocalFile()) {
        muse::io::path_t filePath = url.toLocalFile();
        if (muse::audio::synth::isSoundFont(filePath)) {
            return DragTarget::SoundFont;
        } else if (extensionInstaller()->isFileSupported(filePath)) {
            return DragTarget::Extension;
        } else {
            bool scorePageWithProjectOpen = interactive()->currentUri().val == NOTATION_URI
                                            && projectSession()->project() != nullptr;
            if (!scorePageWithProjectOpen && convertFileToScoreScenario()->isFileSupported(filePath)) {
                return DragTarget::ConvertibleFile;
            }
        }
    }
    return DragTarget::Unknown;
}

bool AppshellCommandsController::onDragEnterEvent(QDragEnterEvent* event)
{
    return onDragMoveEvent(event);
}

bool AppshellCommandsController::onDragMoveEvent(QDragMoveEvent* event)
{
    const QMimeData* mime = event->mimeData();
    QList<QUrl> urls = mime->urls();
    if (urls.count() > 0) {
        const QUrl& url = urls.front();
        DragTarget target = dragTarget(url);
        if (target != DragTarget::Unknown) {
            event->setDropAction(Qt::LinkAction);
            event->acceptProposedAction();
            return true;
        }
    }

    return false;
}

bool AppshellCommandsController::onDropEvent(QDropEvent* event)
{
    const QMimeData* mime = event->mimeData();
    QList<QUrl> urls = mime->urls();
    if (urls.count() > 0) {
        const QUrl& url = urls.front();

        bool shouldBeHandled = true;
        DragTarget target = dragTarget(url);
        switch (target) {
        case DragTarget::ProjectFile: {
            async::Async::call(this, [this, url]() {
                    openProjectScenario()->openProject(url)
                    .onResolve(this, [](const Ret& ret) {
                        if (!ret) {
                            LOGE() << ret.toString();
                        }
                    });
                });
        } break;
        case DragTarget::SoundFont: {
            muse::io::path_t filePath = url.toLocalFile();
            async::Async::call(this, [this, filePath]() {
                    soundFontInstallScenario()->installSoundFont(Uri::fromLocalFile(filePath));
                });
        } break;
        case DragTarget::Extension: {
            muse::io::path_t filePath = url.toLocalFile();
            async::Async::call(this, [this, filePath]() {
                    extensionInstaller()->installExtension(filePath);
                });
        } break;
        case DragTarget::ConvertibleFile: {
            muse::io::paths_t paths;
            for (const QUrl& u : urls) {
                if (u.isLocalFile()) {
                    paths.push_back(muse::io::path_t(u.toLocalFile()));
                }
            }
            async::Async::call(this, [this, paths]() {
                    convertFileToScoreScenario()->convertFiles(paths);
                });
        } break;
        case DragTarget::Unknown:
            shouldBeHandled = false;
            break;
        }

        if (shouldBeHandled) {
            event->accept();
        } else {
            event->ignore();
        }

        return shouldBeHandled;
    }

    return false;
}

muse::async::Promise<muse::Ret> AppshellCommandsController::quit(const muse::rcommand::Params& params)
{
    bool isAllInstances = params.at("all_instances", Val(true)).toBool();
    muse::io::path_t installatorPath = params.at("installer_path").toString();
    return quit(isAllInstances, installatorPath);
}

muse::async::Promise<muse::Ret> AppshellCommandsController::quit(bool isAllInstances, const muse::io::path_t& installerPath)
{
    if (m_quiting) {
        return resolvedPromise(muse::make_ret(Ret::Code::Busy));
    }

    m_quiting = true;

    return muse::async::make_promise<Ret>([this, isAllInstances, installerPath](auto resolve) {
        closeProjectScenario()->closeOpenedProject(false)
        .onResolve(this, [this, isAllInstances, installerPath, resolve](const Ret& ret) {
            if (!ret) {
                LOGD() << "quit cancelled: " << ret.toString();
                m_quiting = false;
                (void)resolve(ret);
                return;
            }

            //! NOTE `doQuit` destroys this window, so let's answer before it
            (void)resolve(muse::make_ok());

            doQuit(isAllInstances, installerPath);
        });

        return muse::async::Promise<Ret>::dummy_result();
    });
}

muse::async::Promise<muse::Ret> AppshellCommandsController::resolvedPromise(const muse::Ret& ret)
{
    return muse::async::make_promise<Ret>([ret](auto resolve) {
        return resolve(ret);
    });
}

void AppshellCommandsController::doQuit(bool isAllInstances, const muse::io::path_t& installerPath)
{
    if (multiwindowsProvider()->isFirstWindow() && !installerPath.empty()) {
        //! NOTE: All windows are quitting to complete the update, apply it
        //! in-place, falling back to handing the package to the user.
        bool applied = false;
        if (appUpdateService()->canAutoInstall()) {
            applied = bool(appUpdateService()->installUpdate());
        }

        if (!applied) {
#if defined(Q_OS_LINUX)
            platformInteractive()->revealInFileBrowser(installerPath);
#else
            platformInteractive()->openUrl(QUrl::fromLocalFile(installerPath.toQString()));
#endif
        }
    }

    if (!multiwindowsProvider()->isFirstWindow()) {
        multiwindowsProvider()->notifyAboutWindowWasQuited();
    }

    //! NOTE the following destroys the IoC context and `this` with it,
    //! so don't access `this` after this point!
    if (isAllInstances) {
        multiwindowsProvider()->quitForAll(iocContext());
    } else {
        multiwindowsProvider()->quitWindow(iocContext());
    }
}

void AppshellCommandsController::restart()
{
    closeProjectScenario()->closeOpenedProject(false)
    .onResolve(this, [this](const Ret& ret) {
        if (!ret) {
            LOGD() << "restart cancelled: " << ret.toString();
            return;
        }

        if (multiwindowsProvider()->windowCount() == 1) {
            application()->restart();
        } else {
            multiwindowsProvider()->quitAllAndRestartLast();

            QCoreApplication::exit();
        }
    });
}

void AppshellCommandsController::toggleFullScreen()
{
    mainWindow()->toggleFullScreen();
}

void AppshellCommandsController::openAboutDialog()
{
    interactive()->open("musescore://about/musescore");
}

void AppshellCommandsController::openAboutQtDialog()
{
    QApplication::aboutQt();
}

void AppshellCommandsController::openAboutMusicXMLDialog()
{
    interactive()->open("musescore://about/musicxml");
}

void AppshellCommandsController::openOnlineHandbookPage()
{
    std::string handbookUrl = configuration()->handbookUrl();
    platformInteractive()->openUrl(handbookUrl);
}

void AppshellCommandsController::openExperimentalChoirPage()
{
    // Open only the installed local resource. Never fall back to a web URL.
    const QString page = QDir(globalConfiguration()->appDataPath().toQString()).filePath("choir-studio/index.html");
    if (!QFileInfo::exists(page)) {
        LOGW() << "Choir studio not installed: " << page;
        interactive()->error(muse::trc("appshell", "Choir studio is not installed"),
                             muse::trc("appshell", "The offline choir studio files are missing. Reinstall MuseScore Studio."));
        return;
    }
    platformInteractive()->openUrl(QUrl::fromLocalFile(page));
}

void AppshellCommandsController::createEditableScoreCopy()
{
    // The original is already saved and clean. Copy its bytes, not the live
    // engraving model: SaveCopy may relayout headers and mutate that model.
    const auto original = projectSession()->project();
    if (!original || original->path().empty() || original->isCloudProject()) {
        interactive()->error(muse::trc("appshell", "Save the original locally first"),
                             muse::trc("appshell", "Open a saved local score before creating an editable copy."));
        return;
    }
    if (original->isNeedSave()) {
        interactive()->error(muse::trc("appshell", "Save the original first"),
                             muse::trc("appshell", "Save your current score before creating a separate editable copy."));
        return;
    }
    if (!original->canSave()) {
        interactive()->error(muse::trc("appshell", "Cannot copy this score"),
                             muse::trc("appshell", "The current score cannot be saved safely. Fix it before creating a copy."));
        return;
    }

    const muse::io::path_t originalPath = original->path();
    const QFileInfo sourceInfo(originalPath.toQString());
    if (!sourceInfo.isFile() || sourceInfo.suffix().compare("mscz", Qt::CaseInsensitive) != 0) {
        interactive()->error(muse::trc("appshell", "Save the original as .mscz first"),
                             muse::trc("appshell", "Open a saved local .mscz score before making a copy."));
        return;
    }
    const QString suggested = sourceInfo.dir().filePath(sourceInfo.completeBaseName() + " - Voice Studio.mscz");
    const std::vector<std::string> filter { muse::trc("appshell", "MuseScore score") + " (*.mscz)" };
    interactive()->selectSavingFile(muse::trc("appshell", "Create editable score copy"),
                                    muse::io::path_t(QUrl::fromLocalFile(suggested)), filter)
    .onResolve(this, [this, original, originalPath](const muse::io::path_t& destination) {
        if (destination.empty()) {
            return;
        }
        const QFileInfo targetInfo(destination.toQString());
        if (projectSession()->project() != original || original->isNeedSave() || !original->canSave()
            || original->path() != originalPath || targetInfo.suffix().compare("mscz", Qt::CaseInsensitive) != 0
            || targetInfo.exists() || targetInfo.isSymbolicLink()
            || targetInfo.absoluteFilePath() == QFileInfo(originalPath.toQString()).absoluteFilePath()) {
            interactive()->error(muse::trc("appshell", "Choose a new score-copy path"),
                                 muse::trc("appshell",
                                           "The original changed, or this path is not a new .mscz file. Choose an unused location."));
            return;
        }
        // QFile::copy refuses an existing destination even if it appears after
        // our check, so no accidental overwrite or save of the original occurs.
        if (!QFile::copy(originalPath.toQString(), destination.toQString())) {
            interactive()->error(muse::trc("appshell", "Could not create the score copy"),
                                 muse::trc("appshell", "Choose an unused writable .mscz path and try again."));
            return;
        }
        const QFile::Permissions permissions = QFile::permissions(destination.toQString());
        if (!QFile::setPermissions(destination.toQString(), permissions | QFileDevice::ReadOwner | QFileDevice::WriteOwner)) {
            QFile::remove(destination.toQString());
            interactive()->error(muse::trc("appshell", "Could not make the copy editable"),
                                 muse::trc("appshell", "Choose a writable location and try again."));
            return;
        }
        openProjectScenario()->openProject(destination).onResolve(this, [this, destination](const muse::Ret& opened) {
            if (!opened) {
                interactive()->error(muse::trc("appshell", "Score copy saved but not opened"), opened.toString());
                return;
            }
            const auto copy = projectSession()->project();
            if (!copy || copy->path() != destination
                || !copy->setVoiceStudioData("{\"version\":1,\"clips\":[]}", {})) {
                interactive()->error(muse::trc("appshell", "Score copy opened without Voice Studio"),
                                     muse::trc("appshell", "Open the copy in this window and try again."));
                return;
            }
            const muse::Ret saved = copy->save();
            if (!saved) {
                interactive()->error(muse::trc("appshell", "Could not save Voice Studio in the copy"), saved.toString());
            }
        });
    });
}

void AppshellCommandsController::openAskForHelpPage()
{
    std::string askForHelpUrl = configuration()->askForHelpUrl();
    platformInteractive()->openUrl(askForHelpUrl);
}

void AppshellCommandsController::openAccessibilityStatementPage()
{
    std::string accessibilityStatementUrl = configuration()->accessibilityStatementUrl();
    platformInteractive()->openUrl(accessibilityStatementUrl);
}

void AppshellCommandsController::openPreferencesDialog()
{
    if (!playbackState()->isPlaying()) {
        doOpenPreferencesDialog();
    } else {
        commandDispatcher()->dispatch(STOP_COMMAND)
        .onResolve(this, [this](const muse::rcommand::Response& ) {
            doOpenPreferencesDialog();
        });
    }
}

void AppshellCommandsController::doOpenPreferencesDialog()
{
    if (multiwindowsProvider()->isPreferencesAlreadyOpened()) {
        multiwindowsProvider()->activateWindowWithOpenedPreferences();
        return;
    }

    interactive()->open("muse://preferences");
}

void AppshellCommandsController::revertToFactorySettings()
{
    std::string title = muse::trc("appshell", "Are you sure you want to revert to factory settings?");
    std::string question = muse::trc("appshell", "This action will reset all your app preferences and delete all custom palettes and custom shortcuts. "
                                                 "The list of recent scores will also be cleared.\n\n"
                                                 "This action will not delete any of your scores.");

    IInteractive::ButtonData cancelBtn = interactive()->buttonData(IInteractive::Button::Cancel);
    cancelBtn.accent = true;

    int revertBtn = int(IInteractive::Button::Apply);
    auto promise = interactive()->warning(title, question,
                                          { cancelBtn,
                                            IInteractive::ButtonData(revertBtn, muse::trc("appshell", "Revert")) },
                                          cancelBtn.btn, { muse::IInteractive::Option::WithIcon },
                                          muse::trc("appshell", "Revert to factory settings"));

    promise.onResolve(this, [this](const IInteractive::Result& res) {
        if (res.isButton(IInteractive::Button::Cancel)) {
            return;
        }

        static constexpr bool KEEP_DEFAULT_SETTINGS = false;
        static constexpr bool NOTIFY_ABOUT_CHANGES = false;
        static constexpr bool NOTIFY_OTHER_INSTANCES = false;
        configuration()->revertToFactorySettings(KEEP_DEFAULT_SETTINGS, NOTIFY_ABOUT_CHANGES, NOTIFY_OTHER_INSTANCES);

        std::string title = muse::trc("appshell", "Would you like to restart MuseScore Studio now?");
        std::string question = muse::trc("appshell", "MuseScore Studio needs to be restarted for these changes to take effect.");

        int restartBtn = int(IInteractive::Button::Apply);
        auto promise = interactive()->question(title, question,
                                               { interactive()->buttonData(IInteractive::Button::Cancel),
                                                 IInteractive::ButtonData(restartBtn, muse::trc("appshell", "Restart"), true) },
                                               restartBtn);

        promise.onResolve(this, [this](const IInteractive::Result& res) {
            if (!res.isButton(IInteractive::Button::Cancel)) {
                restart();
            }
        });
    });
}

void AppshellCommandsController::openExtensions()
{
    interactive()->open("musescore://home?section=plugins");
}
