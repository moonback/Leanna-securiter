/**
 * BrowserPanel — Navigateur web intégré via Electron <webview>.
 * Contrôlable depuis l'extérieur (prop `url`) pour permettre à Leanna
 * de piloter la navigation. Émet des CustomEvents pour notifier le reste
 * de l'application des changements d'URL/titre/contenu.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { BrowserExternalOverlay } from './BrowserExternalOverlay.js';
import { BrowserToolbar } from './BrowserToolbar.js';
import type {
  BrowserPanelProps,
  WebviewElement,
  WebviewFailLoadEvent,
  WebviewNavigateEvent,
  WebviewTitleEvent,
} from './browserTypes.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

export const BROWSER_HOME_URL = 'https://www.google.com/webhp?igu=1';

export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return BROWSER_HOME_URL;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}/.test(trimmed) && !trimmed.includes(' ')) {
    return `https://${trimmed}`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

// ─── Composant ───────────────────────────────────────────────────────────────

export function BrowserPanel({
  onClose,
  onOpenExternal,
  url: controlledUrl,
  defaultUrl = BROWSER_HOME_URL,
  fullWidth = false,
  width = '520px',
}: BrowserPanelProps) {
  const webviewRef = useRef<WebviewElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [inputValue, setInputValue] = useState(defaultUrl);
  const [currentUrl, setCurrentUrl] = useState(defaultUrl);
  const [loading, setLoading] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [pageTitle, setPageTitle] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Indicateur visuel quand Leanna pilote la navigation */
  const [assistantNavActive, setAssistantNavActive] = useState(false);
  /** Indique si une fenêtre externe est ouverte */
  const [isExternalWindowOpen, setIsExternalWindowOpen] = useState(false);
  /** Référence à la fenêtre externe ouverte (pour vérifier closed) */
  const externalWindowRef = useRef<Window | null>(null);

  /** true dès que le <webview> a émis dom-ready — loadURL ne peut être appelé qu'après */
  const domReadyRef = useRef(false);
  /** URL en attente si elle arrive avant que dom-ready soit émis */
  const pendingUrlRef = useRef<string | null>(null);

  // ── Navigation interne ──────────────────────────────────────────────────────

  const navigateTo = useCallback((raw: string) => {
    const url = normalizeUrl(raw);
    setLoadError(null);
    setInputValue(url);
    if (domReadyRef.current) {
      webviewRef.current?.loadURL(url);
    } else {
      // Le webview n'est pas encore prêt — on met l'URL en attente
      pendingUrlRef.current = url;
    }
  }, []);

  // ── Navigation contrôlée depuis l'extérieur (Leanna) ───────────────────────

  useEffect(() => {
    if (!controlledUrl) return;
    const normalized = normalizeUrl(controlledUrl);
    if (normalized === currentUrl) return;
    setAssistantNavActive(true);
    navigateTo(normalized);
    const timer = setTimeout(() => setAssistantNavActive(false), 3000);
    return () => clearTimeout(timer);
  }, [controlledUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handlers clavier barre d'adresse ───────────────────────────────────────

  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        navigateTo(inputValue);
        inputRef.current?.blur();
      } else if (e.key === 'Escape') {
        setInputValue(currentUrl);
        inputRef.current?.blur();
      }
    },
    [inputValue, currentUrl, navigateTo],
  );

  const handleGoBack = useCallback(() => webviewRef.current?.goBack(), []);
  const handleGoForward = useCallback(() => webviewRef.current?.goForward(), []);
  const handleRefresh = useCallback(() => {
    setLoadError(null);
    webviewRef.current?.reload();
  }, []);
  const handleHome = useCallback(() => navigateTo(BROWSER_HOME_URL), [navigateTo]);
  // Référence pour l'intervalle de vérification de la fenêtre externe
  const externalWindowCheckRef = useRef<NodeJS.Timeout | null>(null);

  const handleOpenInNewWindow = useCallback(() => {
    // Dans Electron, on utilise toujours shell.openExternal pour ouvrir dans le navigateur par défaut
    // window.open() ne fonctionne pas correctement dans Electron pour les fenêtres externes
    try {
      const { shell } = require('electron');
      shell.openExternal(currentUrl);
      
      // Avec shell.openExternal, on ne peut pas détecter quand la fenêtre est fermée
      // L'overlay reste affiché jusqu'à ce que l'utilisateur clique sur "Fermer le message"
      externalWindowRef.current = null;
      setIsExternalWindowOpen(true);
      
    } catch {
      // Si on n'est pas dans Electron (mode dev web), essayer window.open
      const extWindow = window.open(currentUrl, '_blank', 'noopener,noreferrer');
      
      if (extWindow) {
        externalWindowRef.current = extWindow;
        setIsExternalWindowOpen(true);
        
        // Nettoyer l'intervalle précédent
        if (externalWindowCheckRef.current) {
          clearInterval(externalWindowCheckRef.current);
        }
        
        // Vérifier périodiquement si la fenêtre est fermée
        externalWindowCheckRef.current = setInterval(() => {
          if (extWindow.closed) {
            setIsExternalWindowOpen(false);
            externalWindowRef.current = null;
            if (externalWindowCheckRef.current) {
              clearInterval(externalWindowCheckRef.current);
              externalWindowCheckRef.current = null;
            }
          }
        }, 500);
      }
    }
    
    onOpenExternal?.();
  }, [currentUrl, onOpenExternal]);

  // Nettoyer l'intervalle quand le composant est démonté
  useEffect(() => {
    return () => {
      if (externalWindowCheckRef.current) {
        clearInterval(externalWindowCheckRef.current);
        externalWindowCheckRef.current = null;
      }
    };
  }, []);

  // ── Événements webview ──────────────────────────────────────────────────────

  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv) return;

    // Les attributs spécifiques Electron qui ne sont pas dans React's WebViewHTMLAttributes
    // doivent être settés directement sur l'élément natif (évite le warning
    // "Received false for a non-boolean attribute allowpopups" + erreur TS2322).
    try {
      (wv as any).setAttribute?.('allowpopups', 'false');
      (wv as any).setAttribute?.('webpreferences', 'contextIsolation=yes, javascript=yes');
    } catch { /* noop */ }

    const onDomReady = () => {
      domReadyRef.current = true;
      // Charger l'URL mise en attente si elle existe
      if (pendingUrlRef.current) {
        wv.loadURL(pendingUrlRef.current);
        pendingUrlRef.current = null;
      }
    };

    const onLoadStart = () => {
      setLoading(true);
      setLoadError(null);
    };

    const onLoadStop = () => {
      setLoading(false);
      const url = wv.getURL();
      setCurrentUrl(url);
      setInputValue(url);
      setCanGoBack(wv.canGoBack());
      setCanGoForward(wv.canGoForward());

      // Notifier l'app (utilisé par le skill pour confirmer la navigation)
      window.dispatchEvent(new CustomEvent('Leanna-browser-navigated', {
        detail: { url },
      }));
    };

    const onTitleUpdate = (e: Event) => {
      const title = (e as WebviewTitleEvent).title;
      setPageTitle(title);
      window.dispatchEvent(new CustomEvent('Leanna-browser-title-updated', {
        detail: { title, url: wv.getURL() },
      }));
    };

    const onFailLoad = (e: Event) => {
      const ev = e as WebviewFailLoadEvent;
      if (ev.errorCode === -3) {
        // ERR_ABORTED — annulation normale (navigation remplacée avant fin de chargement, destroy, etc.)
        setLoading(false);
        return;
      }
      setLoading(false);
      setLoadError(`Impossible de charger cette page (${ev.errorDescription})`);
    };

    const onNavigate = (e: Event) => {
      const ev = e as WebviewNavigateEvent;
      setCurrentUrl(ev.url);
      setInputValue(ev.url);
      setCanGoBack(wv.canGoBack());
      setCanGoForward(wv.canGoForward());
    };

    wv.addEventListener('dom-ready', onDomReady);
    wv.addEventListener('did-start-loading', onLoadStart);
    wv.addEventListener('did-stop-loading', onLoadStop);
    wv.addEventListener('page-title-updated', onTitleUpdate);
    wv.addEventListener('did-fail-load', onFailLoad);
    wv.addEventListener('did-navigate', onNavigate);
    wv.addEventListener('did-navigate-in-page', onNavigate);

    return () => {
      wv.removeEventListener('dom-ready', onDomReady);
      wv.removeEventListener('did-start-loading', onLoadStart);
      domReadyRef.current = false;
      wv.removeEventListener('did-stop-loading', onLoadStop);
      wv.removeEventListener('page-title-updated', onTitleUpdate);
      wv.removeEventListener('did-fail-load', onFailLoad);
      wv.removeEventListener('did-navigate', onNavigate);
      wv.removeEventListener('did-navigate-in-page', onNavigate);
    };
  }, []);

  // ── Écoute des commandes directes via CustomEvent (fallback / scroll) ───────

  useEffect(() => {
    const handleNav = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail?.url) return;
      setAssistantNavActive(true);
      navigateTo(detail.url);
      setTimeout(() => setAssistantNavActive(false), 3000);
    };

    const handleScroll = (e: Event) => {
      const detail = (e as CustomEvent).detail as { direction: string; amount: number };
      const wv = webviewRef.current;
      if (!wv) return;

      let js = '';
      if (detail.direction === 'top') {
        js = 'window.scrollTo({ top: 0, behavior: "smooth" })';
      } else if (detail.direction === 'bottom') {
        js = 'window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" })';
      } else if (detail.direction === 'up') {
        js = `window.scrollBy({ top: -${detail.amount ?? 300}, behavior: "smooth" })`;
      } else {
        js = `window.scrollBy({ top: ${detail.amount ?? 300}, behavior: "smooth" })`;
      }
      wv.executeJavaScript(js).catch(() => {/* ignore */});
    };

    const handleBrowserControl = (e: Event) => {
      const detail = (e as CustomEvent).detail as { type: string };
      const wv = webviewRef.current;
      if (!wv) return;
      if (detail.type === 'browser-back') {
        wv.goBack();
      } else if (detail.type === 'browser-forward') {
        wv.goForward();
      } else if (detail.type === 'browser-reload') {
        setLoadError(null);
        wv.reload();
      }
    };

    // ── Canal retour : Leanna demande le contenu de la page ──────────────
    const handleReadRequest = async (e: Event) => {
      const detail = (e as CustomEvent).detail as { requestId: string; selector: string | null };
      const wv = webviewRef.current;
      if (!wv) return;

      const extractScript = detail.selector
        ? `(function(){
            var el = document.querySelector(${JSON.stringify(detail.selector)});
            return el ? el.innerText.substring(0, 8000) : '[sélecteur introuvable: ${detail.selector}]';
          })()`
        : `(function(){
            var title = document.title;
            var url = location.href;
            var clone = document.body.cloneNode(true);
            ['script','style','nav','footer','header','aside'].forEach(function(tag){
              Array.from(clone.querySelectorAll(tag)).forEach(function(el){ el.remove(); });
            });
            var text = clone.innerText
              .replace(/[ \\t]{2,}/g, ' ')
              .replace(/\\n{3,}/g, '\\n\\n')
              .substring(0, 8000);
            return JSON.stringify({ title: title, url: url, text: text });
          })()`;

      try {
        const raw = await wv.executeJavaScript(extractScript);
        const token = localStorage.getItem('Leanna_api_token') || '';
        await fetch('/api/browser/content-result', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'x-Leanna-token': token } : {}),
          },
          body: JSON.stringify({ requestId: detail.requestId, result: raw, error: null }),
        });
      } catch (err: any) {
        const token = localStorage.getItem('Leanna_api_token') || '';
        await fetch('/api/browser/content-result', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'x-Leanna-token': token } : {}),
          },
          body: JSON.stringify({ requestId: detail.requestId, result: null, error: err?.message ?? 'Erreur JS dans la webview' }),
        }).catch(() => {/* silent */});
      }
    };

    // ── Helper générique : POST résultat d'action webview → backend
    const postActionResult = async (requestId: string, result: any, error: string | null = null) => {
      try {
        const token = localStorage.getItem('Leanna_api_token') || '';
        await fetch('/api/browser/action-result', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'x-Leanna-token': token } : {}),
          },
          body: JSON.stringify({ requestId, result, error }),
        });
      } catch {/* silent */ }
    };

    // ── Curseur simulé : injection + animation dans la webview ──────────────
    // Injecte (une seule fois) un curseur SVG flottant dans la page,
    // puis l'anime vers la position d'un élément cible avant une action.
    const CURSOR_INJECT_SCRIPT = `(function(){
      if (document.getElementById('__Leanna_cursor')) return;
      var cur = document.createElement('div');
      cur.id = '__Leanna_cursor';
      cur.style.cssText = [
        'position:fixed',
        'top:0','left:0',
        'width:22px','height:22px',
        'pointer-events:none',
        'z-index:2147483647',
        'transition:top 0.25s cubic-bezier(.4,0,.2,1),left 0.25s cubic-bezier(.4,0,.2,1)',
        'will-change:top,left',
        'display:block',
      ].join(';');
      cur.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">'
        + '<filter id="cs"><feDropShadow dx="1" dy="1" stdDeviation="1.5" flood-opacity="0.4"/></filter>'
        + '<polygon points="4,2 4,18 8,14 11,20 13,19 10,13 16,13" fill="white" stroke="var(--text-muted)" stroke-width="1" filter="url(#cs)"/>'
        + '</svg>';
      document.body.appendChild(cur);
    })()`;

    const moveCursorToElement = async (wv: WebviewElement, selector: string): Promise<void> => {
      try {
        // Injecter le curseur si absent
        await wv.executeJavaScript(CURSOR_INJECT_SCRIPT);
        // Déplacer vers le centre de l'élément cible
        const moveScript = `(function(){
          var el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return;
          var r = el.getBoundingClientRect();
          var cur = document.getElementById('__Leanna_cursor');
          if (!cur) return;
          cur.style.left = (r.left + r.width / 2 - 4) + 'px';
          cur.style.top  = (r.top  + r.height / 2 - 2) + 'px';
        })()`;
        await wv.executeJavaScript(moveScript);
        // Laisser l'animation CSS se jouer (250 ms transition + 100 ms pause)
        await new Promise<void>((r) => setTimeout(r, 380));
        // Effet ripple au clic
        const rippleScript = `(function(){
          var el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return;
          var r = el.getBoundingClientRect();
          var rip = document.createElement('div');
          rip.style.cssText = [
            'position:fixed',
            'pointer-events:none',
            'z-index:2147483646',
            'border-radius:50%',
            'border:2px solid rgba(139,92,246,0.8)',
            'width:8px','height:8px',
            'left:' + (r.left + r.width/2 - 4) + 'px',
            'top:' + (r.top + r.height/2 - 4) + 'px',
            'transition:all 0.35s ease-out',
            'opacity:1',
          ].join(';');
          document.body.appendChild(rip);
          requestAnimationFrame(function(){
            rip.style.width  = '36px';
            rip.style.height = '36px';
            rip.style.left   = (r.left + r.width/2 - 18) + 'px';
            rip.style.top    = (r.top + r.height/2 - 18) + 'px';
            rip.style.opacity = '0';
          });
          setTimeout(function(){ rip.remove(); }, 400);
        })()`;
        await wv.executeJavaScript(rippleScript);
      } catch {/* ne bloque pas l'action si l'animation échoue */ }
    };

    // ── Clic sur un élément
    const handleClick = async (e: Event) => {
      const detail = (e as CustomEvent).detail as { requestId: string; selector: string };
      const wv = webviewRef.current;
      if (!wv) {
        postActionResult(detail.requestId, null, 'Webview non disponible.');
        return;
      }
      try {
        // Animer le curseur vers la cible avant le clic
        await moveCursorToElement(wv, detail.selector);

        const clickScript = `(function(){
          var el = document.querySelector(${JSON.stringify(detail.selector)});
          if (!el) return JSON.stringify({ error: 'Sélecteur introuvable: ${detail.selector.replace(/'/g, "\\'")}' });
          var evt = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
          el.dispatchEvent(evt);
          return JSON.stringify({ ok: true });
        })()`;
        const raw = await wv.executeJavaScript(clickScript);
        let parsed: any = {};
        try { parsed = typeof raw === 'string' && raw.startsWith('{') ? JSON.parse(raw) : {}; } catch (e) {
          console.debug('[BrowserPanel] JSON parse failed (click action):', e, raw);
        }
        if (parsed?.error) {
          await postActionResult(detail.requestId, null, parsed.error);
          return;
        }
        setTimeout(async () => {
          try {
            const content = await wv.executeJavaScript(`document.body.innerText.substring(0, 3000)`);
            postActionResult(detail.requestId, { content });
          } catch (e) {
            console.debug('[BrowserPanel] Failed to get page content:', e);
            postActionResult(detail.requestId, {});
          }
        }, 1200);
      } catch (err: any) {
        postActionResult(detail.requestId, null, err?.message ?? 'Erreur clic');
      }
    };

    // ── Saisie dans un champ
    const handleType = async (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        requestId: string; selector: string; text: string; pressEnter?: boolean;
      };
      const wv = webviewRef.current;
      if (!wv) {
        postActionResult(detail.requestId, null, 'Webview non disponible.');
        return;
      }
      try {
        // Animer le curseur vers le champ avant la saisie
        await moveCursorToElement(wv, detail.selector);

        const typeScript = `(function(){
          var el = document.querySelector(${JSON.stringify(detail.selector)});
          if (!el) return JSON.stringify({ error: 'Sélecteur introuvable' });
          el.focus();
          if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
            el.value = ${JSON.stringify(detail.text)};
          } else {
            el.setAttribute('contenteditable', 'true');
            el.innerText = ${JSON.stringify(detail.text)};
          }
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return JSON.stringify({ ok: true });
        })()`;
        const raw = await wv.executeJavaScript(typeScript);
        let parsed: any = {};
        try { parsed = typeof raw === 'string' && raw.startsWith('{') ? JSON.parse(raw) : {}; } catch (e) {
          console.debug('[BrowserPanel] JSON parse failed (type action):', e, raw);
        }
        if (parsed?.error) {
          await postActionResult(detail.requestId, null, parsed.error);
          return;
        }
        if (detail.pressEnter) {
          setTimeout(async () => {
            try {
              await wv.executeJavaScript(`
                (function(){
                  var el = document.querySelector(${JSON.stringify(detail.selector)});
                  if (el) {
                    var ev = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true });
                    el.dispatchEvent(ev);
                    ev = new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true });
                    el.dispatchEvent(ev);
                  }
                })();
              `);
            } catch {/* ignore */ }
            postActionResult(detail.requestId, { ok: true });
          }, 300);
        } else {
          postActionResult(detail.requestId, { ok: true });
        }
      } catch (err: any) {
        postActionResult(detail.requestId, null, err?.message ?? 'Erreur saisie');
      }
    };

    // ── Extraction des liens de la page
    const handleGetLinks = async (e: Event) => {
      const detail = (e as CustomEvent).detail as { requestId: string; selector: string | null };
      const wv = webviewRef.current;
      if (!wv) {
        postActionResult(detail.requestId, null, 'Webview non disponible.');
        return;
      }
      const selectorExpr = detail.selector
        ? JSON.stringify(detail.selector + ' a[href]')
        : '"a[href]"';
      const getLinksScript = `(function(){
        try {
          var seen = {};
          var links = Array.from(document.querySelectorAll(${selectorExpr}))
            .map(function(a) {
              var href = a.getAttribute('href');
              if (!href || href === '#' || href.startsWith('javascript:')) return null;
              try { href = new URL(href, location.href).href; } catch(e) { return null; }
              if (seen[href]) return null;
              seen[href] = true;
              return { text: (a.innerText || a.getAttribute('aria-label') || '').trim().substring(0, 200), href: href };
            })
            .filter(Boolean);
          return JSON.stringify(links);
        } catch(e) {
          return JSON.stringify({ error: e.message });
        }
      })()`;
      try {
        const raw = await wv.executeJavaScript(getLinksScript);
        let parsed: any;
        try {
          parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        } catch {
          parsed = [];
        }
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.error) {
          await postActionResult(detail.requestId, null, parsed.error);
          return;
        }
        await postActionResult(detail.requestId, Array.isArray(parsed) ? parsed : []);
      } catch (err: any) {
        await postActionResult(detail.requestId, null, err?.message ?? 'Erreur extraction liens');
      }
    };

    // ── Snapshot des éléments interactifs
    const handleSnapshot = async (e: Event) => {
      const detail = (e as CustomEvent).detail as { requestId: string };
      const wv = webviewRef.current;
      if (!wv) {
        postActionResult(detail.requestId, null, 'Webview non disponible.');
        return;
      }
      const snapshotScript = `(function(){
        var bestSelector = function(el) {
          if (el.id) return '#' + CSS.escape(el.id);
          var testId = el.getAttribute('data-testid') || el.getAttribute('data-test-id');
          if (testId) return '[data-testid="' + CSS.escape(testId) + '"]';
          var name = el.name;
          if (name) return el.tagName.toLowerCase() + '[name="' + CSS.escape(name) + '"]';
          var placeholder = el.placeholder;
          if (placeholder) return el.tagName.toLowerCase() + '[placeholder="' + CSS.escape(placeholder) + '"]';
          var ariaLabel = el.getAttribute('aria-label');
          if (ariaLabel) return '[aria-label="' + CSS.escape(ariaLabel) + '"]';
          var role = el.getAttribute('role');
          if (role) return '[role="' + role + '"]';
          return el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).trim().split(/\\s+/).slice(0, 2).join('.') : '');
        };
        var inputs = Array.from(document.querySelectorAll(
          'input:not([type="hidden"]), textarea, select, [role="textbox"], [role="combobox"], [role="searchbox"]'
        )).slice(0, 20).map(function(el) {
          return {
            selector: bestSelector(el),
            tag: el.tagName.toLowerCase(),
            type: el.type || el.getAttribute('role') || '',
            placeholder: el.placeholder || el.getAttribute('aria-placeholder') || '',
            ariaLabel: el.getAttribute('aria-label') || '',
            name: el.name || '',
            visible: el.offsetParent !== null
          };
        });
        var buttons = Array.from(document.querySelectorAll(
          'button, input[type="submit"], input[type="button"], a[href], [role="button"]'
        )).filter(function(el) { return el.offsetParent !== null; }).slice(0, 15).map(function(el) {
          return {
            selector: bestSelector(el),
            text: (el.innerText || el.getAttribute('aria-label') || el.value || '').trim().substring(0, 80),
            ariaLabel: el.getAttribute('aria-label') || ''
          };
        });
        return JSON.stringify({ url: location.href, title: document.title, inputs: inputs, buttons: buttons });
      })()`;
      try {
        const raw = await wv.executeJavaScript(snapshotScript);
        const parsed = typeof raw === 'string' && raw.startsWith('{') ? JSON.parse(raw) : raw;
        postActionResult(detail.requestId, parsed);
      } catch (err: any) {
        postActionResult(detail.requestId, null, err?.message ?? 'Erreur snapshot');
      }
    };

    // ── Inspection d'éléments spécifiques (CORRIGÉ : ajout du paramètre type)
    const handleInspect = async (e: Event) => {
      const detail = (e as CustomEvent).detail as { requestId: string; inspectType: 'buttons' | 'inputs' | 'links' | 'all' };
      const wv = webviewRef.current;
      if (!wv) {
        postActionResult(detail.requestId, null, 'Webview non disponible.');
        return;
      }
      // La fonction anonyme prend désormais un paramètre `type`
      const inspectScript = `(function(type){
        var bestSelector = function(el) {
          if (el.id) return '#' + CSS.escape(el.id);
          var testId = el.getAttribute('data-testid') || el.getAttribute('data-test-id');
          if (testId) return '[data-testid="' + CSS.escape(testId) + '"]';
          var name = el.name;
          if (name) return el.tagName.toLowerCase() + '[name="' + CSS.escape(name) + '"]';
          var placeholder = el.placeholder;
          if (placeholder) return el.tagName.toLowerCase() + '[placeholder="' + CSS.escape(placeholder) + '"]';
          var ariaLabel = el.getAttribute('aria-label');
          if (ariaLabel) return '[aria-label="' + CSS.escape(ariaLabel) + '"]';
          return el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).trim().split(/\\s+/).slice(0, 2).join('.') : '');
        };
        var results = {};
        if (type === 'buttons' || type === 'all') {
          results.buttons = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], [role="button"]')).map(function(btn) { return { selector: bestSelector(btn), text: (btn.innerText || btn.value || '').trim().substring(0, 80), ariaLabel: btn.getAttribute('aria-label') || '' }; }).slice(0, 12);
        }
        if (type === 'inputs' || type === 'all') {
          results.inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]), textarea, select')).map(function(input) { return { selector: bestSelector(input), type: input.type || 'textarea', placeholder: input.placeholder || '', ariaLabel: input.getAttribute('aria-label') || '', name: input.name || '' }; }).slice(0, 12);
        }
        if (type === 'links' || type === 'all') {
          results.links = Array.from(document.querySelectorAll('a[href]')).map(function(link) { return { selector: bestSelector(link), text: (link.innerText || '').trim().substring(0, 80), href: link.href || '' }; }).slice(0, 12);
        }
        return JSON.stringify(results);
      })(${JSON.stringify(detail.inspectType || 'all')})`;
      try {
        const raw = await wv.executeJavaScript(inspectScript);
        const parsed = typeof raw === 'string' && raw.startsWith('{') ? JSON.parse(raw) : {};
        postActionResult(detail.requestId, parsed);
      } catch (err: any) {
        postActionResult(detail.requestId, null, err?.message ?? 'Erreur inspect');
      }
    };

    // ── Déplacement explicite du curseur simulé vers des coordonnées (x, y)
    const handleMouseMove = async (e: Event) => {
      const detail = (e as CustomEvent).detail as { x: number; y: number };
      const wv = webviewRef.current;
      if (!wv) return;
      const lx = (Number(detail.x) || 0) - 4;
      const ly = (Number(detail.y) || 0) - 2;
      try {
        await wv.executeJavaScript(CURSOR_INJECT_SCRIPT);
        await wv.executeJavaScript(
          `(function(x,y){ var cur=document.getElementById('__Leanna_cursor'); if(cur){cur.style.left=x+'px';cur.style.top=y+'px';} })(${lx},${ly})`
        );
      } catch {/* silent */ }
    };

    // ── Helper : attente d'une condition dans la webview (Sprint 1 — J2) ──────
    // Attente générique avec polling 100ms jusqu'à timeout.
    const waitForConditionInPage = async (
      wv: WebviewElement,
      condition: string,
      conditionType: 'selector' | 'text' | 'url',
      timeoutMs: number
    ): Promise<{ found: boolean; elapsed: number }> => {
      const start = Date.now();
      const interval = 100;
      while (Date.now() - start < timeoutMs) {
        try {
          let found = false;
          if (conditionType === 'selector') {
            found = await wv.executeJavaScript(
              `!!document.querySelector(${JSON.stringify(condition)})`
            ) as boolean;
          } else if (conditionType === 'text') {
            found = await wv.executeJavaScript(
              `document.body.innerText.includes(${JSON.stringify(condition)})`
            ) as boolean;
          } else if (conditionType === 'url') {
            found = await wv.executeJavaScript(
              `location.href.includes(${JSON.stringify(condition)})`
            ) as boolean;
          }
          if (found) return { found: true, elapsed: Date.now() - start };
        } catch {/* page still loading */ }
        await new Promise<void>((r) => setTimeout(r, interval));
      }
      return { found: false, elapsed: timeoutMs };
    };

    // ── Sprint 1 — J1 : Snapshot accessibilité (ARIA tree) ───────────────────
    const handleAccessibilitySnapshot = async (e: Event) => {
      const detail = (e as CustomEvent).detail as { requestId: string };
      const wv = webviewRef.current;
      if (!wv) {
        postActionResult(detail.requestId, null, 'Webview non disponible.');
        return;
      }
      const ariaScript = `(function(){
        var INTERACTIVE_ROLES = ['button','link','textbox','combobox','listbox','checkbox',
          'radio','menuitem','menuitemcheckbox','menuitemradio','option','tab','switch',
          'slider','spinbutton','searchbox','tree','treeitem','gridcell','columnheader'];
        var bestSelector = function(el) {
          if (el.id) return '#' + CSS.escape(el.id);
          var testId = el.getAttribute('data-testid') || el.getAttribute('data-test-id');
          if (testId) return '[data-testid="' + CSS.escape(testId) + '"]';
          var ariaLabelledBy = el.getAttribute('aria-labelledby');
          if (ariaLabelledBy) {
            var labelEl = document.getElementById(ariaLabelledBy);
            if (labelEl) return '[aria-labelledby="' + CSS.escape(ariaLabelledBy) + '"]';
          }
          var ariaLabel = el.getAttribute('aria-label');
          if (ariaLabel) return '[aria-label="' + CSS.escape(ariaLabel) + '"]';
          var name = el.name;
          if (name) return el.tagName.toLowerCase() + '[name="' + CSS.escape(name) + '"]';
          var role = el.getAttribute('role');
          if (role) return el.tagName.toLowerCase() + '[role="' + role + '"]';
          return el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).trim().split(/\\s+/).slice(0,2).join('.') : '');
        };
        var getAccessibleName = function(el) {
          var label = el.getAttribute('aria-label');
          if (label) return label.trim();
          var labelledBy = el.getAttribute('aria-labelledby');
          if (labelledBy) {
            var parts = labelledBy.split(/\\s+/).map(function(id){
              var ref = document.getElementById(id);
              return ref ? ref.innerText.trim() : '';
            }).filter(Boolean);
            if (parts.length) return parts.join(' ');
          }
          var forEl = el.id ? document.querySelector('label[for="' + CSS.escape(el.id) + '"]') : null;
          if (forEl) return forEl.innerText.trim();
          var placeholder = el.getAttribute('placeholder') || el.getAttribute('aria-placeholder');
          if (placeholder) return placeholder.trim();
          var text = (el.innerText || el.textContent || el.value || el.getAttribute('title') || '').trim();
          return text.substring(0, 100);
        };
        var elements = [];
        var seen = new WeakSet();
        // 1. Éléments avec rôle ARIA explicite
        INTERACTIVE_ROLES.forEach(function(role) {
          Array.from(document.querySelectorAll('[role="' + role + '"]')).forEach(function(el) {
            if (seen.has(el) || el.offsetParent === null) return;
            seen.add(el);
            elements.push({
              role: role,
              name: getAccessibleName(el),
              selector: bestSelector(el),
              tag: el.tagName.toLowerCase(),
              disabled: el.getAttribute('aria-disabled') === 'true' || el.hasAttribute('disabled'),
              checked: el.getAttribute('aria-checked'),
              expanded: el.getAttribute('aria-expanded'),
              required: el.getAttribute('aria-required') === 'true' || el.hasAttribute('required'),
            });
          });
        });
        // 2. Éléments HTML natifs (boutons, inputs, liens, selects)
        var nativeSelectors = [
          { sel: 'button:not([aria-hidden="true"])', role: 'button' },
          { sel: 'input:not([type="hidden"]):not([aria-hidden="true"])', role: 'textbox' },
          { sel: 'textarea:not([aria-hidden="true"])', role: 'textbox' },
          { sel: 'select:not([aria-hidden="true"])', role: 'combobox' },
          { sel: 'a[href]:not([aria-hidden="true"])', role: 'link' },
        ];
        nativeSelectors.forEach(function(def) {
          Array.from(document.querySelectorAll(def.sel)).forEach(function(el) {
            if (seen.has(el) || el.offsetParent === null) return;
            seen.add(el);
            var inferredRole = el.getAttribute('type') === 'checkbox' ? 'checkbox'
              : el.getAttribute('type') === 'radio' ? 'radio'
              : el.getAttribute('type') === 'submit' || el.getAttribute('type') === 'button' ? 'button'
              : def.role;
            elements.push({
              role: inferredRole,
              name: getAccessibleName(el),
              selector: bestSelector(el),
              tag: el.tagName.toLowerCase(),
              disabled: el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true',
              checked: el.checked !== undefined ? el.checked : null,
              expanded: el.getAttribute('aria-expanded'),
              required: el.hasAttribute('required') || el.getAttribute('aria-required') === 'true',
            });
          });
        });
        var stats = {
          total: elements.length,
          byRole: {}
        };
        elements.forEach(function(el) {
          stats.byRole[el.role] = (stats.byRole[el.role] || 0) + 1;
        });
        return JSON.stringify({ url: location.href, title: document.title, elements: elements, stats: stats });
      })()`;
      try {
        const raw = await wv.executeJavaScript(ariaScript);
        const parsed = typeof raw === 'string' && raw.startsWith('{') ? JSON.parse(raw) : {};
        postActionResult(detail.requestId, parsed);
      } catch (err: any) {
        postActionResult(detail.requestId, null, err?.message ?? 'Erreur accessibility snapshot');
      }
    };

    // ── Sprint 1 — J1 : Clic par rôle ARIA ───────────────────────────────────
    const handleClickByRole = async (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        requestId: string;
        role: string;
        accessibleName: string;
        waitFor: string | null;
      };
      const wv = webviewRef.current;
      if (!wv) {
        postActionResult(detail.requestId, null, 'Webview non disponible.');
        return;
      }
      const clickByRoleScript = `(function(role, name){
        var getAccessibleName = function(el) {
          var label = el.getAttribute('aria-label');
          if (label) return label.trim().toLowerCase();
          var labelledBy = el.getAttribute('aria-labelledby');
          if (labelledBy) {
            var parts = labelledBy.split(/\\s+/).map(function(id){
              var ref = document.getElementById(id);
              return ref ? ref.innerText.trim() : '';
            }).filter(Boolean);
            if (parts.length) return parts.join(' ').toLowerCase();
          }
          var forEl = el.id ? document.querySelector('label[for="' + CSS.escape(el.id) + '"]') : null;
          if (forEl) return forEl.innerText.trim().toLowerCase();
          return (el.innerText || el.textContent || el.value || el.getAttribute('placeholder') || el.getAttribute('title') || '').trim().toLowerCase();
        };
        var nameLower = name.toLowerCase();
        // Chercher par rôle ARIA explicite
        var candidates = Array.from(document.querySelectorAll('[role="' + role + '"]'));
        // Ajouter les éléments HTML natifs selon le rôle
        if (role === 'button') candidates = candidates.concat(Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"]')));
        if (role === 'link') candidates = candidates.concat(Array.from(document.querySelectorAll('a[href]')));
        if (role === 'textbox') candidates = candidates.concat(Array.from(document.querySelectorAll('input:not([type="hidden"]), textarea')));
        if (role === 'combobox') candidates = candidates.concat(Array.from(document.querySelectorAll('select')));
        if (role === 'checkbox') candidates = candidates.concat(Array.from(document.querySelectorAll('input[type="checkbox"]')));
        if (role === 'radio') candidates = candidates.concat(Array.from(document.querySelectorAll('input[type="radio"]')));
        // Dédupliquer et filtrer par nom
        var seen = new WeakSet();
        var match = null;
        for (var i = 0; i < candidates.length; i++) {
          var el = candidates[i];
          if (seen.has(el)) continue;
          seen.add(el);
          if (el.offsetParent === null) continue; // invisible
          if (nameLower && !getAccessibleName(el).includes(nameLower)) continue;
          match = el;
          break;
        }
        if (!match) return JSON.stringify({ error: 'Aucun élément [role="' + role + '"] avec le nom "' + name + '" trouvé.' });
        var evt = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
        match.dispatchEvent(evt);
        return JSON.stringify({ ok: true });
      })(${JSON.stringify(detail.role)}, ${JSON.stringify(detail.accessibleName)})`;
      try {
        await moveCursorToElement(wv, `[role="${detail.role}"]`).catch(() => {/* ignore si pas trouvé */ });
        const raw = await wv.executeJavaScript(clickByRoleScript);
        let parsed: any = {};
        try { parsed = typeof raw === 'string' && raw.startsWith('{') ? JSON.parse(raw) : {}; } catch (e) {
          console.debug('[BrowserPanel] JSON parse failed (clickByRole):', e, raw);
        }
        if (parsed?.error) {
          postActionResult(detail.requestId, null, parsed.error);
          return;
        }
        // Attendre la condition waitFor si fournie
        let changed: Record<string, boolean> = {};
        if (detail.waitFor) {
          const urlBefore = await wv.executeJavaScript('location.href').catch(() => '') as string;
          const waitResult = await waitForConditionInPage(wv, detail.waitFor, 'selector', 5000);
          if (!waitResult.found) {
            // Essayer en mode texte
            const textResult = await waitForConditionInPage(wv, detail.waitFor, 'text', 2000);
            changed = { elementAppeared: textResult.found };
          } else {
            changed = { elementAppeared: true };
          }
          const urlAfter = await wv.executeJavaScript('location.href').catch(() => '') as string;
          changed.url = urlAfter !== urlBefore;
        }
        postActionResult(detail.requestId, { ok: true, changed });
      } catch (err: any) {
        postActionResult(detail.requestId, null, err?.message ?? 'Erreur click-by-role');
      }
    };

    // ── Sprint 1 — J1 : Saisie par libellé ───────────────────────────────────
    const handleTypeByLabel = async (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        requestId: string;
        label: string;
        text: string;
        pressEnter: boolean;
        waitFor: string | null;
      };
      const wv = webviewRef.current;
      if (!wv) {
        postActionResult(detail.requestId, null, 'Webview non disponible.');
        return;
      }
      const typeByLabelScript = `(function(label, text){
        var labelLower = label.toLowerCase();
        var field = null;
        // 1. Recherche par aria-label
        var byAriaLabel = Array.from(document.querySelectorAll('input,textarea,select,[contenteditable]')).find(function(el){
          return (el.getAttribute('aria-label') || '').toLowerCase().includes(labelLower);
        });
        if (byAriaLabel) field = byAriaLabel;
        // 2. Recherche par <label for="...">
        if (!field) {
          var labels = Array.from(document.querySelectorAll('label'));
          for (var i = 0; i < labels.length; i++) {
            if (labels[i].innerText.toLowerCase().includes(labelLower)) {
              var forId = labels[i].getAttribute('for');
              if (forId) {
                field = document.getElementById(forId);
                if (field) break;
              }
              // label wrapping
              field = labels[i].querySelector('input,textarea,select');
              if (field) break;
            }
          }
        }
        // 3. Recherche par placeholder
        if (!field) {
          field = Array.from(document.querySelectorAll('input,textarea')).find(function(el){
            return (el.placeholder || el.getAttribute('aria-placeholder') || '').toLowerCase().includes(labelLower);
          }) || null;
        }
        if (!field) return JSON.stringify({ error: 'Champ avec le libellé "' + label + '" introuvable.' });
        field.focus();
        // Effacer le contenu existant
        if (field.tagName.toLowerCase() !== 'select') {
          if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
            field.value = '';
            field.dispatchEvent(new Event('input', { bubbles: true }));
          } else {
            field.innerHTML = '';
          }
        }
        // Saisie caractère par caractère
        for (var c = 0; c < text.length; c++) {
          var char = text[c];
          field.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
          if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
            field.value += char;
          } else {
            field.textContent += char;
          }
          field.dispatchEvent(new Event('input', { bubbles: true }));
          field.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
        }
        field.dispatchEvent(new Event('change', { bubbles: true }));
        return JSON.stringify({ ok: true, selector: field.id ? '#' + field.id : field.tagName.toLowerCase() });
      })(${JSON.stringify(detail.label)}, ${JSON.stringify(detail.text)})`;
      try {
        const raw = await wv.executeJavaScript(typeByLabelScript);
        let parsed: any = {};
        try { parsed = typeof raw === 'string' && raw.startsWith('{') ? JSON.parse(raw) : {}; } catch (e) {
          console.debug('[BrowserPanel] JSON parse failed (typeByLabel):', e, raw);
        }
        if (parsed?.error) {
          postActionResult(detail.requestId, null, parsed.error);
          return;
        }
        // pressEnter
        if (detail.pressEnter && parsed?.selector) {
          await new Promise<void>((r) => setTimeout(r, 300));
          await wv.executeJavaScript(`(function(){
            var el = document.querySelector(${JSON.stringify(parsed.selector)});
            if (el) {
              el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
              el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
            }
          })()`).catch(() => {/* ignore */});
        }
        // waitFor
        let changed: Record<string, boolean> = {};
        if (detail.waitFor) {
          const waitResult = await waitForConditionInPage(wv, detail.waitFor, 'selector', 5000);
          if (!waitResult.found) {
            const textResult = await waitForConditionInPage(wv, detail.waitFor, 'text', 2000);
            changed = { elementAppeared: textResult.found };
          } else {
            changed = { elementAppeared: true };
          }
        }
        postActionResult(detail.requestId, { ok: true, changed });
      } catch (err: any) {
        postActionResult(detail.requestId, null, err?.message ?? 'Erreur type-by-label');
      }
    };

    // ── Sprint 1 — J2 : Attente de condition ─────────────────────────────────
    const handleWaitFor = async (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        requestId: string;
        condition: string;
        conditionType: 'selector' | 'text' | 'url';
        timeout: number;
      };
      const wv = webviewRef.current;
      if (!wv) {
        postActionResult(detail.requestId, null, 'Webview non disponible.');
        return;
      }
      try {
        const result = await waitForConditionInPage(
          wv,
          detail.condition,
          detail.conditionType ?? 'selector',
          detail.timeout ?? 10_000
        );
        postActionResult(detail.requestId, result);
      } catch (err: any) {
        postActionResult(detail.requestId, null, err?.message ?? 'Erreur wait-for');
      }
    };

    // ── Sprint 1 — J3 : Texte d'un élément ───────────────────────────────────
    const handleGetElementText = async (e: Event) => {
      const detail = (e as CustomEvent).detail as { requestId: string; selector: string };
      const wv = webviewRef.current;
      if (!wv) {
        postActionResult(detail.requestId, null, 'Webview non disponible.');
        return;
      }
      const script = `(function(){
        var el = document.querySelector(${JSON.stringify(detail.selector)});
        if (!el) return JSON.stringify({ found: false });
        var text = el.innerText !== undefined ? el.innerText : (el.textContent || el.getAttribute('value') || '');
        return JSON.stringify({ found: true, text: text.trim().substring(0, 2000) });
      })()`;
      try {
        const raw = await wv.executeJavaScript(script);
        const parsed = typeof raw === 'string' && raw.startsWith('{') ? JSON.parse(raw) : { found: false };
        postActionResult(detail.requestId, parsed);
      } catch (err: any) {
        postActionResult(detail.requestId, null, err?.message ?? 'Erreur get-element-text');
      }
    };

    // ── Sprint 1 — J3 : Attribut d'un élément ────────────────────────────────
    const handleGetElementAttribute = async (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        requestId: string;
        selector: string;
        attribute: string;
      };
      const wv = webviewRef.current;
      if (!wv) {
        postActionResult(detail.requestId, null, 'Webview non disponible.');
        return;
      }
      const script = `(function(){
        var el = document.querySelector(${JSON.stringify(detail.selector)});
        if (!el) return JSON.stringify({ found: false });
        var val = el.getAttribute(${JSON.stringify(detail.attribute)});
        // Pour 'value', lire la propriété JS plutôt que l'attribut HTML
        if (val === null && ${JSON.stringify(detail.attribute)} === 'value' && el.value !== undefined) {
          val = el.value;
        }
        return JSON.stringify({ found: true, value: val });
      })()`;
      try {
        const raw = await wv.executeJavaScript(script);
        const parsed = typeof raw === 'string' && raw.startsWith('{') ? JSON.parse(raw) : { found: false };
        postActionResult(detail.requestId, parsed);
      } catch (err: any) {
        postActionResult(detail.requestId, null, err?.message ?? 'Erreur get-element-attribute');
      }
    };

    // ── Sprint 1 — J3 : Remplissage de formulaire (fill avec effacement) ─────
    const handleFillForm = async (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        requestId: string;
        selector: string;
        value: string;
        waitFor: string | null;
      };
      const wv = webviewRef.current;
      if (!wv) {
        postActionResult(detail.requestId, null, 'Webview non disponible.');
        return;
      }
      try {
        await moveCursorToElement(wv, detail.selector);
      } catch {/* ignore animation errors */ }
      const script = `(function(){
        var el = document.querySelector(${JSON.stringify(detail.selector)});
        if (!el) return JSON.stringify({ found: false });
        el.focus();
        // Effacer le contenu existant
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          el.value = '';
        } else {
          el.innerHTML = '';
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        // Saisie caractère par caractère pour déclencher les événements React/Vue
        var text = ${JSON.stringify(detail.value)};
        for (var i = 0; i < text.length; i++) {
          var char = text[i];
          el.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
          if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
            el.value += char;
          } else {
            el.textContent = (el.textContent || '') + char;
          }
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
        }
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return JSON.stringify({ found: true, ok: true });
      })()`;
      try {
        const raw = await wv.executeJavaScript(script);
        let parsed: any = {};
        try { parsed = typeof raw === 'string' && raw.startsWith('{') ? JSON.parse(raw) : {}; } catch (e) {
          console.debug('[BrowserPanel] JSON parse failed (scrollAndClick):', e, raw);
        }
        if (!parsed.found) {
          postActionResult(detail.requestId, { found: false });
          return;
        }
        // waitFor post-action
        let changed: Record<string, boolean> = {};
        if (detail.waitFor) {
          const waitResult = await waitForConditionInPage(wv, detail.waitFor, 'selector', 5000);
          changed = { elementAppeared: waitResult.found };
        }
        postActionResult(detail.requestId, { found: true, ok: true, changed });
      } catch (err: any) {
        postActionResult(detail.requestId, null, err?.message ?? 'Erreur fill-form');
      }
    };

    // ── Sprint 1 — J3 : Sélection d'option dans un <select> ──────────────────
    const handleSelectOption = async (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        requestId: string;
        selector: string;
        value: string;
      };
      const wv = webviewRef.current;
      if (!wv) {
        postActionResult(detail.requestId, null, 'Webview non disponible.');
        return;
      }
      const script = `(function(){
        var el = document.querySelector(${JSON.stringify(detail.selector)});
        if (!el || el.tagName.toLowerCase() !== 'select') return JSON.stringify({ found: false });
        var target = ${JSON.stringify(detail.value)}.toLowerCase();
        var selectedText = null;
        // Chercher par value d'abord, puis par texte visible
        for (var i = 0; i < el.options.length; i++) {
          var opt = el.options[i];
          if (opt.value.toLowerCase() === target || opt.text.toLowerCase().includes(target)) {
            el.value = opt.value;
            selectedText = opt.text;
            break;
          }
        }
        if (selectedText === null) return JSON.stringify({ found: true, ok: false });
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return JSON.stringify({ found: true, ok: true, selectedText: selectedText });
      })()`;
      try {
        const raw = await wv.executeJavaScript(script);
        const parsed = typeof raw === 'string' && raw.startsWith('{') ? JSON.parse(raw) : { found: false };
        postActionResult(detail.requestId, parsed);
      } catch (err: any) {
        postActionResult(detail.requestId, null, err?.message ?? 'Erreur select-option');
      }
    };

    window.addEventListener('Leanna-browser-navigate', handleNav);
    window.addEventListener('Leanna-browser-scroll', handleScroll);
    window.addEventListener('Leanna-browser-control', handleBrowserControl);
    window.addEventListener('Leanna-browser-read-request', handleReadRequest as EventListener);
    window.addEventListener('Leanna-browser-click', handleClick as EventListener);
    window.addEventListener('Leanna-browser-type', handleType as EventListener);
    window.addEventListener('Leanna-browser-get-links', handleGetLinks as EventListener);
    window.addEventListener('Leanna-browser-snapshot', handleSnapshot as EventListener);
    window.addEventListener('Leanna-browser-inspect', handleInspect as EventListener);
    window.addEventListener('Leanna-browser-mouse-move', handleMouseMove as EventListener);
    // Sprint 1 — J1 : Accessibilité
    window.addEventListener('Leanna-browser-accessibility-snapshot', handleAccessibilitySnapshot as EventListener);
    window.addEventListener('Leanna-browser-click-by-role', handleClickByRole as EventListener);
    window.addEventListener('Leanna-browser-type-by-label', handleTypeByLabel as EventListener);
    // Sprint 1 — J2 : Robustesse
    window.addEventListener('Leanna-browser-wait-for', handleWaitFor as EventListener);
    // Sprint 1 — J3 : Actions primitives
    window.addEventListener('Leanna-browser-get-element-text', handleGetElementText as EventListener);
    window.addEventListener('Leanna-browser-get-element-attribute', handleGetElementAttribute as EventListener);
    window.addEventListener('Leanna-browser-fill-form', handleFillForm as EventListener);
    window.addEventListener('Leanna-browser-select-option', handleSelectOption as EventListener);
    return () => {
      window.removeEventListener('Leanna-browser-navigate', handleNav);
      window.removeEventListener('Leanna-browser-scroll', handleScroll);
      window.removeEventListener('Leanna-browser-control', handleBrowserControl);
      window.removeEventListener('Leanna-browser-read-request', handleReadRequest as EventListener);
      window.removeEventListener('Leanna-browser-click', handleClick as EventListener);
      window.removeEventListener('Leanna-browser-type', handleType as EventListener);
      window.removeEventListener('Leanna-browser-get-links', handleGetLinks as EventListener);
      window.removeEventListener('Leanna-browser-snapshot', handleSnapshot as EventListener);
      window.removeEventListener('Leanna-browser-inspect', handleInspect as EventListener);
      window.removeEventListener('Leanna-browser-mouse-move', handleMouseMove as EventListener);
      // Sprint 1 — J1 : Accessibilité
      window.removeEventListener('Leanna-browser-accessibility-snapshot', handleAccessibilitySnapshot as EventListener);
      window.removeEventListener('Leanna-browser-click-by-role', handleClickByRole as EventListener);
      window.removeEventListener('Leanna-browser-type-by-label', handleTypeByLabel as EventListener);
      // Sprint 1 — J2 : Robustesse
      window.removeEventListener('Leanna-browser-wait-for', handleWaitFor as EventListener);
      // Sprint 1 — J3 : Actions primitives
      window.removeEventListener('Leanna-browser-get-element-text', handleGetElementText as EventListener);
      window.removeEventListener('Leanna-browser-get-element-attribute', handleGetElementAttribute as EventListener);
      window.removeEventListener('Leanna-browser-fill-form', handleFillForm as EventListener);
      window.removeEventListener('Leanna-browser-select-option', handleSelectOption as EventListener);
    };
  }, [navigateTo]);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div
      className={`flex flex-col min-h-0 ${fullWidth ? 'flex-1 min-w-0' : 'border-l'}`}
      style={fullWidth ? {
        borderColor: 'var(--border-base)',
        backgroundColor: 'var(--bg-panel)',
      } : {
        width,
        minWidth: width,
        maxWidth: width,
        borderColor: 'var(--border-base)',
        backgroundColor: 'var(--bg-panel)',
      }}
    >
      <BrowserToolbar
        pageTitle={pageTitle}
        assistantNavActive={assistantNavActive}
        currentUrl={currentUrl}
        inputValue={inputValue}
        loading={loading}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        inputRef={inputRef}
        onClose={onClose}
        onInputChange={setInputValue}
        onInputKeyDown={handleInputKeyDown}
        onGoBack={handleGoBack}
        onGoForward={handleGoForward}
        onRefresh={handleRefresh}
        onHome={handleHome}
        onOpenExternal={handleOpenInNewWindow}
      />

      {/* ── Error banner ── */}
      {loadError && (
        <div
          className="flex items-center gap-2 px-3 py-2 text-sm flex-shrink-0"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--color-error) 10%, transparent)',
            borderBottom: '1px solid color-mix(in srgb, var(--color-error) 25%, transparent)',
            color: 'var(--color-error)',
          }}
        >
          <AlertTriangle size={12} />
          <span className="flex-1 truncate">{loadError}</span>
        </div>
      )}

      {/* ── Webview ── */}
      <div className="flex-1 min-h-0 relative">
        <webview
          ref={webviewRef}
          src={defaultUrl}
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            // Masquer le webview quand l'overlay est affiché
            visibility: isExternalWindowOpen ? 'hidden' : 'visible',
          }}
        />
        
        {isExternalWindowOpen && (
          <BrowserExternalOverlay
            onDismiss={() => {
              if (externalWindowRef.current && !externalWindowRef.current.closed) {
                externalWindowRef.current.close();
              }
              setIsExternalWindowOpen(false);
              externalWindowRef.current = null;
            }}
          />
        )}
      </div>
    </div>
  );
}