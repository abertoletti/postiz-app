const assert = require('node:assert/strict');
const { test } = require('node:test');
const { rewriteFrontend } = require('./brand-hub-native-ui.cjs');

test('rebrands the auth layout while retaining the original form', () => {
  const bundle = `function auth(form) {
    return (0, ui.jsxs)("div", {
      className: "bg-[#0E0E0E] flex flex-1 p-[12px] gap-[12px] min-h-screen w-screen text-white",
      children: [
        (0, ui.jsx)(Redirect, {}),
        (0, ui.jsx)("form", { onSubmit: submit, children: form }),
        (0, ui.jsxs)("div", {
          className: "text-[36px] flex-1 pt-[88px] hidden lg:flex flex-col items-center",
          children: ["Postiz To Grow Their Social Presence", (0, ui.jsx)(Testimonial, {})]
        })
      ]
    });
  }`;
  const rewritten = rewriteFrontend(bundle);
  assert.match(rewritten, /className: "brand-hub-auth"/);
  assert.match(rewritten, /onSubmit: submit, children: form/);
  assert.match(rewritten, /jsx\)\(Redirect, \{\}\)/);
  assert.doesNotMatch(rewritten, /Testimonial|Social Presence/);
});

test('replaces app-facing labels, logos and titles while preserving URLs and identifiers', () => {
  const bundle = `const id = "Postiz";
  const settings = {title: \`\${isGeneral()?"Postiz":"Gitroom"} Settings\`};
  const logout = {children:[t("logout_from","Logout from"), cloud ? " Postiz" : " Gitroom"]};
  const webhook = t("webhooks_help", "Notice activity in Postiz via HTTP");
  const details = {href:"https://docs.postiz.com/public-api/oauth", children:"Postiz documentation"};
  const logo = (0, ui.jsxs)("svg", {viewBox:"0 0 101 33", children: originalArtwork});
  const sidebarLogo = (0, ui.jsxs)("svg", {viewBox:"0 0 60 60", className:"mt-[8px] min-w-[60px] min-h-[60px]", children: originalArtwork});
  const providerLogo = (0, ui.jsxs)("svg", {viewBox:"0 0 60 60", children: providerArtwork});
  const icon = {src:"/postiz.svg", alt:"Postiz"};
  const command = "npx postiz@latest";
  const provider = {name:"Postiz", identifier:"postiz"};`;
  const rewritten = rewriteFrontend(bundle);
  assert.match(rewritten, /const id = "Postiz";/);
  assert.match(rewritten, /"Brand Hub"\} Settings/);
  assert.match(rewritten, /Logout from"\), " Brand Hub"/);
  assert.match(rewritten, /Notice activity in Brand Hub via HTTP/);
  assert.match(rewritten, /https:\/\/docs\.postiz\.com\/public-api\/oauth/);
  assert.match(rewritten, /"brand-hub-wordmark"/);
  assert.equal(rewritten.match(/"brand-hub-wordmark"/g).length, 2);
  assert.match(rewritten, /viewBox:"0 0 60 60", children: providerArtwork/);
  assert.match(rewritten, /src:"\/brand-hub-logo\.svg", alt:"Brand Hub"/);
  assert.match(rewritten, /npx postiz@latest/);
  assert.match(rewritten, /name:"Postiz", identifier:"postiz"/);
});

test('changes catalog values for all locales without changing message keys and upstream commands', () => {
  const catalog = {
    calendar: 'Calendario',
    add_a_webhook: 'Aggiungi webhook',
    webhooks_postiz_help: 'Ricevi gli eventi di Postiz via HTTP.',
    billing_entrepreneurs_count: '20.000 imprenditori',
    cli_onboarding_description: 'Installa Postiz CLI.',
    integration_command: 'npx postiz@latest',
    documentation: 'Apri https://docs.postiz.com/public-api/introduction',
  };
  const bundle = `var catalog = JSON.parse(${JSON.stringify(JSON.stringify(catalog))});`;
  const rewritten = rewriteFrontend(bundle);
  const next = JSON.parse(JSON.parse(rewritten.match(/JSON\.parse\((.*?)\);/)[1]));
  assert.equal(next.webhooks_postiz_help, 'Ricevi gli eventi di Brand Hub via HTTP.');
  assert.equal(next.cli_onboarding_description, 'Installa CLI.');
  assert.equal(next.integration_command, catalog.integration_command);
  assert.equal(next.documentation, catalog.documentation);
});
