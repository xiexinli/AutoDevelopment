# Deterministic Android layout project — development, not real AI

L1 is static checking only. Kotlin/Android compilation and L2 have NOT been run. No APK.

37 widget types map to the baseline Android classes. LIST/GRID/BANNER/TAB_LAYOUT with children are rejected: adapters/item templates are not implemented. Empty instances are empty views; SPINNER and BOTTOM_NAV have no data/menu. IMAGE/AVATAR/VIDEO have no media sources. RICH_TEXT uses SpannableString without authored spans. AVATAR uses an oval outline (circle only at square size).

Width/height, padding/margin, background, text color/size, radius, border, alpha, visibility and gravity are emitted where supported. Constraint/relative children use a deterministic vertical chain; no authored constraint editing. CARD applies card background/radius; custom border is not rendered. Native complex widgets may ignore text/gravity, margins depend on parent, themed controls may differ. Native clickable child controls can consume parent events. DIVIDER uses input height (set 1dp for baseline default), LABEL uses input padding. Click/long/double empty callbacks coexist; click is delayed 300ms when double-click enabled.

Local build prerequisites: JDK17, Android SDK35, network to Google/Maven/Gradle. Restore base64 wrapper JAR as binary; chmod +x gradlew after export. Fixed direct dependency versions are listed in dependency-versions.json; transitive Gradle lockfiles have not been resolved.
