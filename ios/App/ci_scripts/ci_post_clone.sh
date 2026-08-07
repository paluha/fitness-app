#!/bin/sh
# Xcode Cloud: ставим Node и npm-зависимости ДО резолва Swift-пакетов.
# Capacitor-ядро подключается как SPM-пакет; node_modules нужны для cap sync.
set -e

export HOMEBREW_NO_INSTALL_CLEANUP=1
export HOMEBREW_NO_AUTO_UPDATE=1
brew install node@22 || brew install node
export PATH="/opt/homebrew/opt/node@22/bin:/usr/local/opt/node@22/bin:$PATH"

node -v
cd "$CI_PRIMARY_REPOSITORY_PATH"
npm ci --ignore-scripts
echo "node_modules ready"

# Страховка: если cap sync запускали на Windows, локальные пути к SPM-пакетам
# в CapApp-SPM/Package.swift пишутся через обратный слэш → Swift падает с
# «invalid escape sequence». Нормализуем в прямые слэши.
SPM_PKG="ios/App/CapApp-SPM/Package.swift"
if [ -f "$SPM_PKG" ] && grep -q '\\node_modules' "$SPM_PKG"; then
  sed -i '' 's|\\|/|g' "$SPM_PKG"
  echo "CapApp-SPM/Package.swift: backslashes normalized"
fi

# Разрешаем авторезолв SPM и убираем устаревший Package.resolved
defaults write com.apple.dt.Xcode IDEPackageOnlyUseVersionsFromResolvedFile -bool NO
defaults write com.apple.dt.Xcode IDEDisableAutomaticPackageResolution -bool NO
rm -f ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved
echo "swift package auto-resolution enabled"
