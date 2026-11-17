<template>
  <div class="min-h-dvh lg:grid lg:grid-cols-[236px_1fr]">
    <aside class="sticky top-0 hidden h-dvh border-r border-rule bg-surround lg:block">
      <AppNav />
    </aside>

    <header class="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-rule bg-surround/95 px-4 backdrop-blur lg:hidden">
      <NuxtLink to="/" class="flex items-center gap-2 text-[15px] font-semibold"><RegMark class="text-cyan" />Mockup Studio</NuxtLink>
      <button class="btn btn-quiet" :aria-expanded="open" aria-label="Menu" @click="open = !open"><Icon :name="open ? 'close' : 'menu'" :size="20" /></button>
    </header>
    <Transition name="drawer">
      <div v-if="open" class="fixed inset-0 top-14 z-20 bg-surround lg:hidden"><AppNav @navigate="open = false" /></div>
    </Transition>

    <main class="min-w-0">
      <div v-if="session?.user && !session.user.emailVerified" class="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-rule bg-paper px-5 py-2.5 text-sm sm:px-8 lg:px-10">
        <span>Bevestig je e-mailadres via de link die we naar {{ session.user.email }} stuurden.</span>
        <button class="underline underline-offset-2" :disabled="sent" @click="resend">{{ sent ? 'Verstuurd' : 'Opnieuw sturen' }}</button>
      </div>
      <slot />
    </main>
    <ToastHost />
  </div>
</template>

<script setup lang="ts">
import { api } from '~/composables/useApi';
import { useSession } from '~/composables/useSession';
import { useToast } from '~/composables/useToast';
const open = ref(false);
const { state: session } = useSession();
const sent = ref(false);
async function resend() {
  try { await api('/api/auth/resend-verification', { method: 'POST' }); sent.value = true; }
  catch (e) { useToast().error((e as Error).message); }
}
</script>

<style scoped>
.drawer-enter-active, .drawer-leave-active { transition: opacity 160ms var(--ease-studio); }
.drawer-enter-from, .drawer-leave-to { opacity: 0; }
</style>
