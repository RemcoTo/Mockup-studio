<template>
  <div>
    <PageHeader title="Scènes" lead="Foto’s waarop je ontwerp geplaatst wordt. Voeg eigen fotografie toe en wijs het vlak aan waar het ontwerp op komt.">
      <template #actions>
        <NuxtLink to="/library/new" class="btn btn-primary"><Icon name="plus" />Foto toevoegen</NuxtLink>
      </template>
    </PageHeader>
    <div class="px-5 py-7 sm:px-8 lg:px-10">
      <ScenePicker manage pick-label="Bekijken" @pick="(s) => navigateTo(`/library/${s.id}`)" />
    </div>
  </div>
</template>
