<script lang="ts">
  import { onMount } from 'svelte'
  import { createEmployee, listUsers, resetEmployeePassword, setEmployeeActive, teamSalesToday, type TeamSaleSummary, type TeamUser } from './api'
  import { formatMoney } from './money'

  let users: TeamUser[] = []
  let today: TeamSaleSummary[] = []
  let username = ''
  let password = ''
  let resetId = ''
  let resetPassword = ''
  let busy = false
  let error = ''
  let notice = ''

  async function refresh() {
    try { [users, today] = await Promise.all([listUsers(), teamSalesToday()]) }
    catch (cause) { error = cause instanceof Error ? cause.message : String(cause) }
  }
  onMount(refresh)

  async function add() {
    busy = true; error = ''; notice = ''
    try {
      await createEmployee(username, password)
      username = ''; password = ''; notice = 'Employee account created.'
      await refresh()
    } catch (cause) { error = cause instanceof Error ? cause.message : String(cause) }
    finally { busy = false }
  }

  async function toggle(user: TeamUser) {
    busy = true; error = ''; notice = ''
    try { await setEmployeeActive(user.id, !user.active); await refresh() }
    catch (cause) { error = cause instanceof Error ? cause.message : String(cause) }
    finally { busy = false }
  }

  async function reset() {
    busy = true; error = ''; notice = ''
    try {
      await resetEmployeePassword(resetId, resetPassword)
      resetId = ''; resetPassword = ''; notice = 'Password changed. The employee must sign in again.'
    } catch (cause) { error = cause instanceof Error ? cause.message : String(cause) }
    finally { busy = false }
  }
</script>

<div class="page-heading"><div><h1>Team</h1><p>Manage access to this store</p></div></div>
{#if error}<div class="form-error" role="alert">{error}</div>{/if}
{#if notice}<div class="notice">{notice}</div>{/if}
<div class="team-grid">
  <section class="panel team-create"><div class="panel-heading"><h2>Add employee</h2></div>
    <form on:submit|preventDefault={add}>
      <label>Username<input autocomplete="off" minlength="3" maxlength="40" pattern="[A-Za-z0-9._-]+" bind:value={username} required /></label>
      <label>Temporary password<input type="password" autocomplete="new-password" minlength="12" bind:value={password} required /></label>
      <button class="primary-button" type="submit" disabled={busy}>Create employee</button>
    </form>
  </section>
  <section class="panel"><div class="panel-heading"><h2>Accounts</h2></div>
    {#each users as user}<div class="team-row"><div><strong>{user.username}</strong><span>{user.role === 'owner' ? 'Owner' : user.active ? 'Employee · Active' : 'Employee · Inactive'}</span></div>{#if user.role === 'employee'}<button class="secondary-button" disabled={busy} on:click={() => toggle(user)}>{user.active ? 'Disable' : 'Enable'}</button><button class="secondary-button" disabled={busy} on:click={() => { resetId = user.id; resetPassword = '' }}>Reset password</button>{/if}</div>{/each}
  </section>
</div>
<section class="panel team-today"><div class="panel-heading"><h2>Sales today by staff</h2></div>
  {#if !today.length}<div class="empty">No sales recorded today.</div>
  {:else}<div class="table-wrap"><table><thead><tr><th>STAFF</th><th>SALES</th><th>AMOUNT</th></tr></thead><tbody>{#each today as item}<tr><td><strong>{item.username}</strong></td><td>{item.count}</td><td>{formatMoney(item.total)}</td></tr>{/each}</tbody></table></div>{/if}
</section>
{#if resetId}<div class="modal-backdrop" role="presentation" on:click|self={() => resetId = ''}><div class="modal" role="dialog" aria-modal="true" aria-label="Reset employee password"><h2>Reset password</h2><form on:submit|preventDefault={reset}><label>New password<input type="password" autocomplete="new-password" minlength="12" bind:value={resetPassword} required /></label><div class="modal-actions"><button class="secondary-button" type="button" on:click={() => resetId = ''}>Cancel</button><button class="primary-button" type="submit" disabled={busy}>Save password</button></div></form></div></div>{/if}
