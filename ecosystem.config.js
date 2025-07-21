module.exports = {
  apps: [{
    name: 'zhcj-web-assistant',
    script: 'server.js',
    cwd: '/root/zhcj-web-assistant-master',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
      API_BASE_URL: 'http://127.0.0.1:8080'
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000,
      API_BASE_URL: 'http://127.0.0.1:8080'
    },
    error_file: '/var/log/pm2/zhcj-web-assistant-error.log',
    out_file: '/var/log/pm2/zhcj-web-assistant-out.log',
    log_file: '/var/log/pm2/zhcj-web-assistant-combined.log',
    time: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    kill_timeout: 5000,
    wait_ready: true,
    listen_timeout: 10000,
    reload_delay: 1000,
    max_restarts: 10,
    min_uptime: '10s'
  }]
}; 