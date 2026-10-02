<script lang="ts">
  import { commandName, type CommandStep, type JournalCommand } from "../lib/journal.ts";
  import { diceExpression, searchOracles, type Oracle } from "../lib/oracles.ts";

  let { commands, oracles, onchange }: { commands: JournalCommand[]; oracles: Oracle[]; onchange: (commands: JournalCommand[]) => void } = $props();

  let editing: { name: string; steps: CommandStep[]; was: string | null } | null = $state(null);
  let query = $state("");
  let problem: string | null = $state(null);

  const suggestions = $derived.by((): CommandStep[] => {
    if (!query.trim()) return [];
    const out: CommandStep[] = [];
    const dice = diceExpression(query);
    if (dice) out.push({ kind: "dice", expression: dice });
    for (const m of searchOracles(oracles, query, 5)) out.push({ kind: "oracle", id: m.oracle.id, name: m.oracle.name });
    return out;
  });

  const stepLabel = (s: CommandStep) => (s.kind === "dice" ? s.expression : s.name);

  function start(c?: JournalCommand) {
    editing = c ? { name: c.name, steps: structuredClone(c.steps), was: c.name } : { name: "", steps: [], was: null };
    query = "";
    problem = null;
  }

  function add(step: CommandStep) {
    if (!editing) return;
    editing.steps = [...editing.steps, step];
    query = "";
  }

  function save() {
    if (!editing) return;
    const name = commandName(editing.name);
    if (!name) return void (problem = "A name is one word: letters, digits, - or _.");
    if (editing.steps.length === 0) return void (problem = "Add at least one roll.");
    if (commands.some((c) => c.name === name && c.name !== editing!.was)) return void (problem = `There is already a /${name}.`);
    const next = commands.filter((c) => c.name !== editing!.was);
    next.push({ name, steps: editing.steps });
    next.sort((a, b) => a.name.localeCompare(b.name));
    onchange(next);
    editing = null;
  }
</script>

<section class="commands-panel">
  <p class="hint">Your own commands for this journal: <kbd>/feeling</kbd> can roll several oracles and dice at once, one chip each.</p>
  {#if commands.length === 0 && !editing}
    <p class="hint">None yet.</p>
  {/if}
  <ul class="command-list">
    {#each commands as c (c.name)}
      <li>
        <span class="command-name">/{c.name}</span>
        <span class="command-steps">{c.steps.map(stepLabel).join(" · ")}</span>
        <span class="command-actions">
          <button type="button" class="link-button" onclick={() => start(c)}>Edit</button>
          <button type="button" class="link-button" onclick={() => onchange(commands.filter((x) => x.name !== c.name))}>Delete</button>
        </span>
      </li>
    {/each}
  </ul>
  {#if editing}
    <form class="command-form" onsubmit={(ev) => (ev.preventDefault(), save())}>
      <label>Name <span class="slash-prefix">/</span><input class="command-name-input" bind:value={editing.name} placeholder="feeling" maxlength="32" /></label>
      <ol class="command-steps-edit">
        {#each editing.steps as s, i (i)}
          <li>{stepLabel(s)} <button type="button" class="link-button" aria-label="Remove {stepLabel(s)}" onclick={() => editing && (editing.steps = editing.steps.filter((_, k) => k !== i))}>✕</button></li>
        {/each}
      </ol>
      <label class="add-step">Add a roll
        <input
          class="step-input"
          bind:value={query}
          placeholder="an oracle's name, or dice like 2d6"
          onkeydown={(ev) => {
            if (ev.key === "Enter") {
              ev.preventDefault();
              if (suggestions[0]) add(suggestions[0]);
            }
          }} />
      </label>
      {#if suggestions.length}
        <ul class="step-suggestions">
          {#each suggestions as s, i (i)}
            <li><button type="button" class="link-button" onclick={() => add(s)}>{s.kind === "dice" ? `Dice ${s.expression}` : s.name}</button></li>
          {/each}
        </ul>
      {/if}
      {#if problem}<p class="problem">{problem}</p>{/if}
      <div class="form-actions">
        <button type="submit" class="open-folder">Save command</button>
        <button type="button" class="link-button" onclick={() => (editing = null)}>Cancel</button>
      </div>
    </form>
  {:else}
    <button type="button" class="open-folder new-command" onclick={() => start()}>New command</button>
  {/if}
</section>
