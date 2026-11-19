const fs=require('fs'),assert=require('assert/strict');
const main='/app/apps/backend/dist/apps/backend/src/main.js';
let text=fs.readFileSync(main,'utf8');const marker='    await (0, start_mcp_1.startMcp)(app);';
assert.equal(text.split(marker).length-1,1);
fs.writeFileSync(main,text.replace(marker,marker+'\n    await require("/opt/postiz-railway/hub/server.cjs").mountHub(app);'));
const nginx='/etc/nginx/nginx.conf';text=fs.readFileSync(nginx,'utf8');assert.ok(text.includes('        location /api/ {'));
text=text.replace('        location /api/ {',`        absolute_redirect off;
        location = /integrations/social/facebook {
            if ($arg_state ~ ^hub_) { rewrite ^ /hub/api/oauth/meta/callback last; }
            proxy_pass http://localhost:4200;
            proxy_set_header Host $host;
        }
        location = /integrations/social/youtube {
            if ($arg_state ~ ^hub_) { rewrite ^ /hub/api/oauth/google/callback last; }
            proxy_pass http://localhost:4200;
            proxy_set_header Host $host;
        }
        location ^~ /uploads/.brand-hub { return 404; }
        location = /hub { return 302 /hub/; }
        location /hub/ {
            proxy_pass http://localhost:3000/hub/;
            proxy_set_header Host $host;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_read_timeout 120s;
        }
        location /api/ {`);
fs.writeFileSync(nginx,text);
console.log('Installed authenticated Brand Hub; private assets excluded from public uploads.');
