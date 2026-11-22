const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const appRequire = createRequire('/app/package.json');
const brandName = 'Brand Hub';
const brandLogo = '/brand-hub-logo.svg';

const authClasses = new Map([
  ['bg-[#0E0E0E] flex flex-1 p-[12px] gap-[12px] min-h-screen w-screen text-white', 'brand-hub-auth'],
  ['flex flex-col py-[40px] px-[20px] flex-1 lg:w-[600px] lg:flex-none rounded-[12px] text-white p-[12px] bg-[#1A1919]', 'brand-hub-auth-card'],
  ['w-full max-w-[440px] mx-auto justify-center gap-[20px] h-full flex flex-col text-white', 'brand-hub-auth-content'],
  ['bg-[#0B0A0A] flex flex-1 min-h-screen w-screen', 'brand-hub-oauth flex flex-1 min-h-screen w-full'],
]);
const authPromotion = 'text-[36px] flex-1 pt-[88px] hidden lg:flex flex-col items-center';
const sidebarLogoClass = 'mt-[8px] min-w-[60px] min-h-[60px]';
const textAttributes = new Set(['children', 'title', 'description', 'alt', 'label', 'placeholder', 'aria-label', 'data-tooltip-content', 'message', 'hint']);
const logoUrls = new Set(['/favicon.ico', '/favicon.png', '/postiz.svg', '/postiz-fav.png', '/postiz-text.svg', '/logo-text.svg']);
const fixedCopy = new Map([
  ['hubspot_installed', 'HubSpot connection ready'],
  ['faq_am_i_going_to_be_charged_by_postiz', 'Which payment terms apply?'],
  ['faq_to_confirm_credit_card_information_postiz_will_hold', 'Review the price and payment terms shown at checkout before subscribing.'],
  ['faq_can_i_trust_postiz_gitroom', 'Where can I find the source code?'],
  ['faq_postiz_gitroom_is_proudly_open_source', 'See the <a href="https://github.com/gitroomhq/postiz-app" target="_blank" rel="noopener noreferrer">upstream open-source repository</a>.'],
]);

function propKey(node) {
  return node?.type === 'Property' && !node.computed ? node.key.name ?? node.key.value : undefined;
}

function objectProp(node, key) {
  return node?.type === 'ObjectExpression' ? node.properties.find(prop => propKey(prop) === key)?.value : undefined;
}

function rebrandCopy(value) {
  if (value === 'MyPostizAgent') return 'MyBrandHubAgent';
  if (value === 'https://postiz.example.com') return 'https://app.example.com';
  if (value.includes('The content will default to "#Postiz"')) {
    return value.replace('The content will default to "#Postiz" and you can edit it inside the TikTok app before publishing.', 'You can add a caption in the TikTok app before publishing.');
  }
  return value
    .replace(' will work with your own Postiz instance. Postiz Cloud relays its requests, and your API key is stored encrypted.', ' will work with your own Brand Hub instance. The external cloud relay forwards requests, and your API key is stored encrypted.')
    .replace(/\b(?:https?:\/\/[^\s"'<>]+|Postiz (?:CLI|MCP)\b|Postiz\b|Gitroom\b)/g, match => {
      if (match === 'Postiz CLI') return 'CLI';
      if (match === 'Postiz MCP') return value.includes('HubSpot') ? match : 'Brand Hub MCP';
      return match === 'Postiz' || match === 'Gitroom' ? brandName : match;
    });
}

function isDisplayPosition(node, ancestors) {
  for (let index = ancestors.length - 2; index >= 0; index--) {
    const parent = ancestors[index];
    const child = ancestors[index + 1];
    if (parent.type === 'Property') return parent.value === child && textAttributes.has(propKey(parent));
    if (parent.type === 'CallExpression') {
      const translationKey = parent.arguments[0]?.value;
      return parent.arguments[1] === child && typeof translationKey === 'string' && /^[a-z0-9_]+$/.test(translationKey);
    }
    if (!['ArrayExpression', 'ConditionalExpression', 'TemplateLiteral', 'LogicalExpression'].includes(parent.type)) return false;
  }
  return false;
}

function isBrandChoice(node) {
  if (node.type !== 'ConditionalExpression') return false;
  const first = node.consequent.value;
  const second = node.alternate.value;
  return (
    typeof first === 'string' && typeof second === 'string' &&
    /^ ?Postiz(?: Calendar)?$/.test(first) && /^ ?Gitroom(?: Launches)?$/.test(second)
  );
}

function isCatalog(node, parent) {
  return parent.type === 'CallExpression' && parent.callee.object?.name === 'JSON' &&
    parent.callee.property?.name === 'parse' && parent.arguments[0] === node &&
    node.value.startsWith('{"calendar":') && node.value.includes('"add_a_webhook":');
}

function rewriteCatalog(source) {
  const catalog = JSON.parse(source);
  let changed = false;
  for (const [key, value] of Object.entries(catalog)) {
    if (typeof value !== 'string') continue;
    const replacement = fixedCopy.get(key) ?? rebrandCopy(value);
    if (value !== replacement) {
      catalog[key] = replacement;
      changed = true;
    }
  }
  return changed ? JSON.stringify(catalog) : source;
}

function rewriteFrontend(source, counts) {
  if (!/Postiz|Gitroom|0 0 101 33|0 0 366 167|0 0 60 60|\/favicon\.ico|\/postiz\.svg|postiz\.example\.com|bg-\[#(?:0E0E0E|0B0A0A)\]/.test(source)) return source;
  const { parse } = appRequire('acorn');
  const { ancestor } = appRequire('acorn-walk');
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  const edits = [];
  const replace = (node, text) => edits.push({ start: node.start, end: node.end, text });

  ancestor(ast, {
    CallExpression(node) {
      const [tag, props] = node.arguments;
      if (fixedCopy.has(tag?.value) && props) replace(props, JSON.stringify(fixedCopy.get(tag.value)));
      const className = objectProp(props, 'className')?.value;
      if (tag?.value === 'div' && className === authPromotion) {
        if (counts) counts.authPanels++;
        replace(node, 'null');
      }
      if (node.callee.type !== 'SequenceExpression') return;
      const factory = node.callee.expressions.at(-1);
      if (!['jsx', 'jsxs'].includes(factory.property?.name)) return;
      const ui = source.slice(factory.object.start, factory.object.end);
      if (
        (tag?.value === 'div' && className?.startsWith('text-[46px] font-[600]') && source.slice(node.start,node.end).includes('billing_join_over')) ||
        (tag?.value === 'h1' && className?.startsWith('text-3xl') && source.slice(node.start,node.end).includes('join_10000_entrepreneurs_who_use_postiz'))
      ) {
        replace(node, '(0,' + ui + '.jsx)("h1",{className:"brand-hub-page-title",children:"Brand Hub Billing"})');
      }
      if (tag?.value === 'div' && className === 'flex' && objectProp(props, 'onClick') && source.slice(node.start,node.end).includes('See the power of Postiz (click here)')) {
        replace(node, 'null');
      }
      if (tag?.value !== 'svg') return;
      const viewBox = objectProp(props, 'viewBox')?.value;
      const isSidebarLogo = viewBox === '0 0 60 60' && className === sidebarLogoClass;
      if (!isSidebarLogo && viewBox !== '0 0 101 33' && viewBox !== '0 0 366 167') return;
      if (viewBox === '0 0 366 167') {
        replace(node, '(0,' + ui + '.jsx)("span",{className:"brand-hub-wordmark-label",children:"Brand Hub"})');
      } else {
        if (counts) counts.wordmarks++;
        const icon = '(0,' + ui + '.jsx)("img",{src:"' + brandLogo + '",width:38,height:38,alt:""})';
        replace(node, '(0,' + ui + '.jsxs)("span",{className:"brand-hub-wordmark",children:[' + icon + ',"Brand Hub"]})');
      }
    },
    ConditionalExpression(node, ancestors) {
      if (!isBrandChoice(node) || !isDisplayPosition(node, ancestors)) return;
      const original = node.consequent.value;
      const label = original === 'Postiz Calendar' ? 'Brand Hub — Calendario' : original.replace('Postiz', brandName);
      replace(node, JSON.stringify(label));
    },
    Literal(node, ancestors) {
      if (typeof node.value !== 'string') return;
      const parent = ancestors.at(-2);
      const key = propKey(parent);
      let value = node.value;
      if (key === 'className') value = authClasses.get(value) ?? value;
      if (['href', 'src'].includes(key) && logoUrls.has(value)) value = brandLogo;
      if (isCatalog(node, parent)) value = rewriteCatalog(value);
      if (isDisplayPosition(node, ancestors) && !isBrandChoice(parent)) value = rebrandCopy(value);
      if (value !== node.value) replace(node, JSON.stringify(value));
    },
    TemplateElement(node, ancestors) {
      if (!isDisplayPosition(node, ancestors)) return;
      const value = rebrandCopy(node.value.raw);
      if (value !== node.value.raw) replace(node, value);
    },
  });

  // Replacing an entire JSX call takes precedence over edits inside that call.
  let result = '';
  let cursor = 0;
  for (const edit of edits.sort((first, second) => first.start - second.start || second.end - first.end)) {
    if (edit.start < cursor) continue;
    result += source.slice(cursor, edit.start) + edit.text;
    cursor = edit.end;
  }
  return result + source.slice(cursor);
}

async function installPublicIcons(frontend, svgPath) {
  const publicRoot = path.join(frontend, 'public');
  const icon = fs.readFileSync(svgPath);
  fs.writeFileSync(path.join(publicRoot, brandLogo.slice(1)), icon);
  const png = await appRequire('sharp')(icon).resize(32, 32).png().toBuffer();
  fs.writeFileSync(path.join(publicRoot, 'favicon.png'), png);
  fs.writeFileSync(path.join(publicRoot, 'postiz-fav.png'), png);
  const icoHeader = Buffer.from([0, 0, 1, 0, 1, 0, 32, 32, 0, 0, 1, 0, 32, 0, 0, 0, 0, 0, 22, 0, 0, 0]);
  icoHeader.writeUInt32LE(png.length, 14);
  fs.writeFileSync(path.join(publicRoot, 'favicon.ico'), Buffer.concat([icoHeader, png]));
}

module.exports = { rewriteFrontend, installPublicIcons };
