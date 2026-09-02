/**
 * Trackit X — marketing component barrel.
 *
 * The route imports `LandingPage` from here. The rest is exported because the
 * closing section, the wordmark and the backdrop are reused by the auth surface,
 * which has to feel like the same product entered through a different door.
 *
 * `AIOrbit` is intentionally absent: it is reached only through `LazyOrbit`'s
 * dynamic import, and re-exporting it here would pull it back into the main chunk
 * and undo the deferral.
 */
export { AIOperatingSystemSection } from './AIOperatingSystemSection';
export { BusinessHealthPreview } from './BusinessHealthPreview';
export { ConnectedOperations } from './ConnectedOperations';
export { CopilotPreview } from './CopilotPreview';
export { FinalCTA } from './FinalCTA';
export type { FinalCTAProps } from './FinalCTA';
export { HeroBackdrop } from './HeroBackdrop';
export { HeroCTA } from './HeroCTA';
export type { HeroCTAProps } from './HeroCTA';
export { HeroSection } from './HeroSection';
export type { HeroSectionProps } from './HeroSection';
export { IntelligenceSection } from './IntelligenceSection';
export { LandingPage } from './LandingPage';
export { LazyOrbit } from './LazyOrbit';
export type { LazyOrbitProps } from './LazyOrbit';
export { MarketingNavbar } from './MarketingNavbar';
export type { MarketingNavbarProps } from './MarketingNavbar';
export { Reveal } from './Reveal';
export type { RevealProps } from './Reveal';
export { SectionShell } from './SectionShell';
export type { SectionShellProps } from './SectionShell';
export { Wordmark } from './Wordmark';
export type { WordmarkProps } from './Wordmark';
