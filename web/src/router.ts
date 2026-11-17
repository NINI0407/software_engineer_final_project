import { createRouter, createWebHistory } from 'vue-router'
import { api } from './api/rest'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: () => import('./pages/Home.vue') },
    { path: '/teacher/login', component: () => import('./pages/TeacherLogin.vue') },
    { path: '/teacher/new', component: () => import('./pages/TeacherNew.vue'), meta: { teacher: true } },
    {
      path: '/teacher/board/:code',
      component: () => import('./pages/TeacherBoard.vue'),
      meta: { teacher: true },
    },
    { path: '/join', component: () => import('./pages/Join.vue') },
    { path: '/play/:code', component: () => import('./pages/Play.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

// 未登入的老師頁面一律導向登入頁（是否登入由後端判斷）
router.beforeEach(async (to) => {
  if (!to.meta.teacher) return true
  try {
    const { authenticated } = await api.session()
    if (authenticated) return true
  } catch {
    // 無法確認時視為未登入
  }
  return { path: '/teacher/login', query: { redirect: to.fullPath } }
})
