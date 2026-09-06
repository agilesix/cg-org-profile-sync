<script lang="ts">
  let { children } = $props();
</script>

<svelte:head>
  <title>Temelio adapter</title>
</svelte:head>

{@render children()}
