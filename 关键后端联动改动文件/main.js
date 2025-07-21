
import Vue from 'vue'
import App from './App.vue'
import VueRouter from "vue-router";
import router from "@/router/index";
import store from "@/store/index";
import ElementUI from 'element-ui';
import 'element-ui/lib/theme-chalk/index.css';
import axios from 'axios';
import '@fortawesome/fontawesome-free/css/all.min.css'
// // 设置全局配置（可选）
axios.defaults.baseURL = 'http://localhost:80';
Vue.prototype.$http = axios;

// axios.defaults.headers.common['Authorization'] = AUTH_TOKEN;

// 挂载到 Vue 原型上（Vue 2）
Vue.prototype.$http = axios;


Vue.config.productionTip = false
Vue.use(VueRouter);
Vue.use(ElementUI);
new Vue({
  render: h => h(App),

  router:router,
  store:store,
  mounted() {
    // 加载AI助手
    const script = document.createElement('script');
    script.src = 'http://localhost:3000/embed.js';
    script.onload = () => {
      window.initAIAssistant({
        config: {
          baseUrl: 'http://localhost:3000',
          position: 'bottom-right',
          theme: 'light',
          enableVoice: true,
          enablePageContext: true
        }
      });
    };
    document.head.appendChild(script);
  }
}).$mount('#app')

