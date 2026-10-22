<script>
  // Auswahl des Vorhersagemodells als Klappliste - gemeinsam für Startseite
  // und Wetter. ★ markiert den Standard; standardSetzen (falls gegeben)
  // zeigt daneben einen Knopf, wenn ein anderes Modell gewählt ist.
  let { modelle = [], wert, standard, waehle, standardSetzen = null } = $props();

  const mitWerten = $derived(modelle.filter((m) => m.stunden));
</script>

<span class="modellwahl">
  <select class="chip" value={wert} onchange={(e) => waehle(e.currentTarget.value)} title="Vorhersagemodell">
    {#each mitWerten as m}
      <option value={m.id}>{m.id === standard ? "★ " : ""}{m.name}</option>
    {/each}
  </select>
  {#if standardSetzen && wert !== standard && mitWerten.some((m) => m.id === wert)}
    <button class="chip" onclick={() => standardSetzen(wert)} title="Dieses Modell als Standard (auch für Startseite und Widget)">★ als Standard</button>
  {/if}
</span>

<style>
  .modellwahl {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  select {
    max-width: 100%;
  }
</style>
