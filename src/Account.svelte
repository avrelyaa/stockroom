<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import { changePassword, type User } from './api'
  export let user: User
  const dispatch = createEventDispatcher<{ signedOut: void }>()
  let currentPassword = ''
  let password = ''
  let confirm = ''
  let busy = false
  let error = ''

  async function save() {
    error = ''
    if (password !== confirm) { error = 'Passwords do not match.'; return }
    busy = true
    try { await changePassword(currentPassword, password); dispatch('signedOut') }
    catch (cause) { error = cause instanceof Error ? cause.message : String(cause) }
    finally { busy = false }
  }
</script>

<div class="page-heading"><div><h1>Account</h1><p>{user.username} · {user.role === 'owner' ? 'Owner' : 'Employee'}</p></div></div>
<section class="panel team-create account-card"><div class="panel-heading"><h2>Change password</h2></div>
  {#if error}<div class="form-error" role="alert">{error}</div>{/if}
  <form on:submit|preventDefault={save}>
    <label>Current password<input type="password" autocomplete="current-password" bind:value={currentPassword} required /></label>
    <label>New password<input type="password" autocomplete="new-password" minlength="12" bind:value={password} required /></label>
    <label>Confirm new password<input type="password" autocomplete="new-password" minlength="12" bind:value={confirm} required /></label>
    <button class="primary-button" type="submit" disabled={busy}>Save password</button>
  </form>
</section>
