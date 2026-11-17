<template>
  <div class="checker"><slot /></div>
</template>
<style scoped>
/* Ruitjespatroon zodat transparantie in een ontwerp zichtbaar is. */
.checker { background-color: #fff; background-image: linear-gradient(45deg, #ececea 25%, transparent 25%), linear-gradient(-45deg, #ececea 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ececea 75%), linear-gradient(-45deg, transparent 75%, #ececea 75%); background-size: 16px 16px; background-position: 0 0, 0 8px, 8px -8px, -8px 0; }
</style>
