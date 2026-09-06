<script lang="ts">
  let { children } = $props();
</script>

<svelte:head>
  <title>FunderHub</title>
</svelte:head>

{@render children()}
