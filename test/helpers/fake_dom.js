// A minimal DOM stand-in for the overlay (content script) and options page tests.
//
// It implements only what those scripts use: element trees, attributes/dataset, classList,
// events (EventTarget, no bubbling), simple selectors, open/closed shadow roots, <select>
// value semantics, and isConnected. It is not a general-purpose DOM.

const BOOLEAN_PROPS = new Set(['hidden', 'disabled', 'checked']);
const REFLECTED_PROPS = new Set(['type', 'value', 'placeholder', 'title', 'min', 'max', 'step', 'for', 'lang', 'name']);

function camelCase(name) {
  return name.replace(/-([a-z])/g, (_m, c) => c.toUpperCase());
}

class FakeNode extends EventTarget {
  constructor(ownerDocument) {
    super();
    this.ownerDocument = ownerDocument;
    this.parentNode = null;
    this.childNodes = [];
  }

  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  removeChild(child) {
    const i = this.childNodes.indexOf(child);
    if (i < 0) throw new Error('removeChild: not a child of this node');
    this.childNodes.splice(i, 1);
    child.parentNode = null;
    return child;
  }

  get isConnected() {
    let n = this;
    while (n) {
      if (n instanceof FakeDocument) return true;
      // Shadow roots are connected through their host.
      n = n.parentNode || (n instanceof FakeShadowRoot ? n.host : null);
    }
    return false;
  }

  get textContent() {
    return this.childNodes.map((c) => c.textContent).join('');
  }

  set textContent(value) {
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes = [];
    const s = value == null ? '' : String(value);
    if (s) this.appendChild(new FakeText(this.ownerDocument, s));
  }

  get children() {
    return this.childNodes.filter((c) => c instanceof FakeElement);
  }

  // Calls `on<type>` handler properties too (e.g. select.onchange), like the real DOM.
  dispatchEvent(event) {
    const result = super.dispatchEvent(event);
    const handler = this[`on${event.type}`];
    if (typeof handler === 'function') handler.call(this, event);
    return result;
  }

  querySelectorAll(selector) {
    const matchers = selector.split(',').map((s) => compileSelector(s.trim()));
    const out = [];
    const walk = (node) => {
      for (const child of node.children) {
        if (matchers.some((m) => m(child))) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
}

class FakeText extends FakeNode {
  constructor(ownerDocument, text) {
    super(ownerDocument);
    this.text = text;
  }

  get textContent() {
    return this.text;
  }

  set textContent(value) {
    this.text = String(value);
  }
}

class FakeElement extends FakeNode {
  constructor(ownerDocument, tagName) {
    super(ownerDocument);
    this.tagName = tagName.toUpperCase();
    this.id = '';
    this.className = '';
    this.style = {};
    this.dataset = {};
    this.attributes = new Map();
    this.shadowRoot = null;
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.value = '';
    this.placeholder = '';
    this.title = '';
    this.type = '';
    this._innerHTML = undefined;
    const self = this;
    this.classList = {
      add: (...names) => self._setClasses([...self._classes(), ...names]),
      remove: (...names) => self._setClasses(self._classes().filter((c) => !names.includes(c))),
      contains: (name) => self._classes().includes(name),
      toggle: (name, force) => {
        const on = force === undefined ? !self.classList.contains(name) : force;
        if (on) self.classList.add(name);
        else self.classList.remove(name);
        return on;
      }
    };
  }

  _classes() {
    return this.className.split(/\s+/).filter(Boolean);
  }

  _setClasses(list) {
    this.className = Array.from(new Set(list)).join(' ');
  }

  setAttribute(name, value) {
    const v = String(value);
    if (name === 'id') this.id = v;
    else if (name === 'class') this.className = v;
    else if (name.startsWith('data-')) this.dataset[camelCase(name.slice(5))] = v;
    else if (BOOLEAN_PROPS.has(name)) this[name] = true;
    else if (REFLECTED_PROPS.has(name)) this[name] = v;
    this.attributes.set(name, v);
  }

  getAttribute(name) {
    if (name === 'id') return this.id || null;
    if (name === 'class') return this.className || null;
    if (name.startsWith('data-')) return this.dataset[camelCase(name.slice(5))] ?? null;
    if (name === 'value' && this.tagName === 'OPTION') return this.value;
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  hasAttribute(name) {
    return this.getAttribute(name) !== null;
  }

  get innerHTML() {
    return this._innerHTML ?? this.textContent;
  }

  // Only clearing and plain-text assignment are supported (the scripts under test never parse
  // markup through innerHTML except options' data-i18n-html, whose raw string is kept).
  set innerHTML(value) {
    const s = String(value ?? '');
    this.textContent = s;
    this._innerHTML = s ? s : undefined;
  }

  attachShadow({ mode }) {
    const root = new FakeShadowRoot(this.ownerDocument, this, mode);
    if (mode === 'open') this.shadowRoot = root;
    return root;
  }

  click() {
    if (this.disabled) return;
    this.dispatchEvent(new Event('click'));
  }

  focus() {}

  select() {}
}

class FakeSelectElement extends FakeElement {
  constructor(ownerDocument) {
    super(ownerDocument, 'select');
    delete this.value;
    this._selectedIndex = undefined;
  }

  get options() {
    return this.querySelectorAll('option');
  }

  get selectedIndex() {
    if (this._selectedIndex === undefined || this._selectedIndex >= this.options.length) {
      return this.options.length > 0 ? 0 : -1;
    }
    return this._selectedIndex;
  }

  set selectedIndex(i) {
    this._selectedIndex = i;
  }

  get value() {
    const opt = this.options[this.selectedIndex];
    return opt ? opt.value : '';
  }

  // Like the real DOM: an unknown value selects nothing (value becomes '').
  set value(v) {
    this._selectedIndex = this.options.findIndex((o) => o.value === String(v));
  }

  set innerHTML(value) {
    super.innerHTML = value;
    this._selectedIndex = undefined;
  }

  get innerHTML() {
    return super.innerHTML;
  }
}

class FakeShadowRoot extends FakeNode {
  constructor(ownerDocument, host, mode) {
    super(ownerDocument);
    this.host = host;
    this.mode = mode;
  }
}

export class FakeDocument extends FakeNode {
  constructor() {
    super(null);
    this.ownerDocument = this;
    this.title = '';
    this.documentElement = this.createElement('html');
    this.appendChild(this.documentElement);
    this.head = this.documentElement.appendChild(this.createElement('head'));
    this.body = this.documentElement.appendChild(this.createElement('body'));
  }

  createElement(tagName) {
    if (String(tagName).toLowerCase() === 'select') return new FakeSelectElement(this);
    return new FakeElement(this, String(tagName));
  }

  createTextNode(text) {
    return new FakeText(this, text);
  }

  getElementById(id) {
    return this.querySelectorAll('*').find((el) => el.id === id) || null;
  }
}

// Supports compound selectors made of: tag, *, #id, .class, [attr], [attr="value"].
function compileSelector(selector) {
  const re = /^([a-zA-Z][\w-]*|\*)?((?:#[\w-]+|\.[\w-]+|\[[\w-]+(?:=(?:"[^"]*"|'[^']*'|[^\]]*))?\])*)$/;
  const m = selector.match(re);
  if (!m) throw new Error(`fake_dom: unsupported selector "${selector}"`);
  const tag = m[1] && m[1] !== '*' ? m[1].toUpperCase() : null;
  const parts = m[2].match(/#[\w-]+|\.[\w-]+|\[[^\]]+\]/g) || [];
  const checks = parts.map((part) => {
    if (part.startsWith('#')) return (el) => el.id === part.slice(1);
    if (part.startsWith('.')) return (el) => el.classList.contains(part.slice(1));
    const [, name, raw] = part.match(/^\[([\w-]+)(?:=(.*))?\]$/);
    if (raw === undefined) return (el) => el.hasAttribute(name);
    const value = raw.replace(/^(["'])(.*)\1$/, '$2');
    return (el) => el.getAttribute(name) === value;
  });
  return (el) => (!tag || el.tagName === tag) && checks.every((check) => check(el));
}

const VOID_TAGS = new Set(['meta', 'input', 'hr', 'br', 'img', 'link']);
const RAW_TEXT_TAGS = new Set(['style', 'script']);

// Parses a small, well-formed HTML document (like public/options.html) or fragment into `doc`.
// <html>, <head> and <body> map onto the document's existing elements; other top-level content
// goes into <body>.
export function loadHtml(doc, html) {
  const stack = [doc.body];
  const top = () => stack[stack.length - 1];
  const tokenRe = /<!--[\s\S]*?-->|<!doctype[^>]*>|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s=>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>|([^<]+)/gi;
  let m;
  while ((m = tokenRe.exec(html))) {
    const [token, closeTag, openTag, attrText, text] = m;
    if (text !== undefined) {
      if (text.trim()) top().appendChild(doc.createTextNode(text));
    } else if (closeTag) {
      const i = stack.map((node) => node.tagName).lastIndexOf(closeTag.toUpperCase());
      if (i > 0) stack.length = i;
    } else if (openTag) {
      const name = openTag.toLowerCase();
      let el;
      if (name === 'html') el = doc.documentElement;
      else if (name === 'head') el = doc.head;
      else if (name === 'body') el = doc.body;
      else el = top().appendChild(doc.createElement(name));
      const attrRe = /([^\s=>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
      let a;
      while ((a = attrRe.exec(attrText || ''))) {
        el.setAttribute(a[1].toLowerCase(), a[2] ?? a[3] ?? a[4] ?? '');
      }
      if (RAW_TEXT_TAGS.has(name)) {
        const end = html.toLowerCase().indexOf(`</${name}`, tokenRe.lastIndex);
        el.textContent = html.slice(tokenRe.lastIndex, end);
        tokenRe.lastIndex = html.indexOf('>', end) + 1;
      } else if (!VOID_TAGS.has(name) && !token.endsWith('/>')) {
        stack.push(el);
      }
    }
  }
  // Like the parser, an <option> without a value attribute takes its text as the value.
  for (const opt of doc.querySelectorAll('option')) {
    if (!opt.attributes.has('value')) opt.value = opt.textContent.trim();
  }
  return doc;
}
