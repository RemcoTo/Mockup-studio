/// <reference lib="dom" />
// De DOM-typen zijn nodig voor code die in de browser van Playwright draait (page.evaluate).
// Cookiebanners verbergen voor een schone screenshot. Eerst bekende consentplatforms via CSS,
// daarna een privacyvriendelijke klik (weigeren) en als laatste vaste overlays met cookietekst.
import type { Page } from 'playwright-core';

export const COOKIE_HIDE_CSS = `
#CybotCookiebotDialog, #CybotCookiebotDialogBodyUnderlay, #onetrust-consent-sdk, #onetrust-banner-sdk,
.cmplz-cookiebanner, #cmplz-cookiebanner-container, .cky-consent-container, .cky-overlay, #cookie-law-info-bar,
#didomi-host, #usercentrics-root, #uc-banner-modal, .qc-cmp2-container, #qc-cmp2-container, #truste-consent-track,
.osano-cm-window, #iubenda-cs-banner, .cc-window, .cc-banner, #cookie-notice, #cookieConsent, .cookie-consent,
#moove_gdpr_cookie_info_bar, .termly-styles-root, #termly-code-snippet-support, #klaro, .klaro, #axeptio_overlay,
#tarteaucitronRoot, #cookiescript_injected, .fc-consent-root, #sp_message_container, [id^="sp_message_container"],
#hs-eu-cookie-confirmation, .cookiefirst-root, #CookieReportsBanner, #borlabs-cookie, ._brlbs-block-content
{ display: none !important; visibility: hidden !important; }
html, body { overflow: auto !important; }
`;

const REJECT_TEXT = /^(alles weigeren|weigeren|alleen (functionele|noodzakelijke|essentiële)( cookies)?|noodzakelijke cookies|reject all|reject|decline|deny|only necessary|necessary only|refuse)$/i;

/** Geeft true als er iets is weggeklikt of verborgen. */
export async function dismissCookieBanners(page: Page): Promise<boolean> {
  return page
    .evaluate((rejectSource) => {
      const reject = new RegExp(rejectSource, 'i');
      let changed = false;
      const candidates = Array.from(document.querySelectorAll<HTMLElement>('button, a[role="button"], [role="button"], input[type="button"]'));
      for (const el of candidates) {
        const text = (el.innerText || (el as HTMLInputElement).value || '').trim().replace(/\s+/g, ' ');
        if (text.length > 40 || !reject.test(text)) continue;
        const box = el.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) continue;
        el.click();
        changed = true;
        break;
      }
      // Overgebleven vaste lagen die het beeld afdekken en over cookies of privacy gaan.
      const vw = window.innerWidth, vh = window.innerHeight;
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
        const cs = getComputedStyle(el);
        if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
        const r = el.getBoundingClientRect();
        if (r.width * r.height < vw * vh * 0.012) continue;
        // Een vaste header of menu met een privacylink is geen cookiebanner.
        if (el.matches('header, nav, [role="navigation"], [role="banner"]') || el.querySelector('nav')) continue;
        const text = (el.innerText || '').toLowerCase();
        if (!/cookie|consent|toestemming/.test(text)) continue;
        if (text.length > 3000) continue; // waarschijnlijk de hele pagina
        el.style.setProperty('display', 'none', 'important');
        changed = true;
      }
      document.documentElement.style.setProperty('overflow', 'auto', 'important');
      document.body.style.setProperty('overflow', 'auto', 'important');
      return changed;
    }, REJECT_TEXT.source)
    .catch(() => false);
}
