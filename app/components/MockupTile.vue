<template>
  <figure class="grid gap-2">
    <div class="group relative overflow-hidden rounded-sm bg-paper">
      <NuxtLink :to="`/editor/${mockup.id}`" class="block aspect-[3/2]">
        <img v-if="mockup.previewUrl" :src="mockup.previewUrl" alt="Mockup" class="h-full w-full object-cover" loading="lazy" />
        <div v-else class="grid h-full place-items-center text-xs text-mist">Nog geen voorbeeld</div>
      </NuxtLink>
      <label v-if="selectable" class="absolute left-2 top-2 grid h-7 w-7 cursor-pointer place-items-center rounded-sm bg-white/90">
        <input type="checkbox" class="check" :checked="selected" :aria-label="'Selecteren'" @change="$emit('toggle')" />
      </label>
      <button class="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-sm bg-white/90" :class="mockup.favorite ? 'text-cyan' : 'text-graphite'" :aria-pressed="mockup.favorite" aria-label="Favoriet" @click="$emit('favorite')">
        <Icon name="star" :size="15" />
      </button>
    </div>
    <figcaption class="flex items-center justify-between gap-2">
      <span class="text-xs" :class="decision ? (decision.kind === 'approve' ? 'text-ok' : 'text-danger') : 'text-graphite'">{{ decision ? (decision.kind === 'approve' ? `Akkoord van ${decision.name}` : `${decision.name} vraagt een wijziging`) : timeAgo(mockup.updatedAt) }}</span>
      <span class="flex gap-1">
        <NuxtLink :to="`/editor/${mockup.id}`" class="btn btn-secondary btn-sm">Bewerken</NuxtLink>
        <ActionMenu v-if="removable" label="Meer acties voor deze mockup">
          <button role="menuitem" class="danger" @click="$emit('remove')"><Icon name="trash" :size="15" />Verwijderen</button>
        </ActionMenu>
      </span>
    </figcaption>
  </figure>
</template>
<script setup lang="ts">
import { timeAgo, type MockupView } from '~/utils/types';
withDefaults(defineProps<{ mockup: MockupView; selected?: boolean; selectable?: boolean; removable?: boolean; decision?: { kind: 'approve' | 'changes'; name: string } | null }>(), { selectable: true, removable: true, decision: null });
defineEmits<{ toggle: []; favorite: []; remove: [] }>();
</script>
