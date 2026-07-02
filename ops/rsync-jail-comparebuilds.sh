#!/bin/sh
# rsync-jail-comparebuilds.sh — forced command confining the comparebuilds CI
# deploy key.
#
# Installed on the deploy host at ~/bin/rsync-jail-comparebuilds.sh and pinned to
# the comparebuilds-deploy key in that account's ~/.ssh/authorized_keys (the
# `restrict` option disables pty, port/agent/X11 forwarding, and user-rc):
#
#   command="/home/www/web4186/bin/rsync-jail-comparebuilds.sh",restrict ssh-ed25519 <public key> comparebuilds-deploy
#
# This file is the REVIEWED SOURCE; the copy on the server is what runs. The
# jailed key can only rsync into the web root — it cannot write ~/bin — so the
# deploy can neither install nor verify this script. After changing it here, an
# admin with full account access must copy it into place manually:
#
#   scp ops/rsync-jail-comparebuilds.sh web4186@http2.core-networks.de:bin/
#
# It allow-lists EXACTLY the SSH commands deploy.sh issues. If you add a new
# `ssh "$REMOTE" "..."` call to deploy.sh, add a matching case here and reinstall,
# or the deploy fails with "rsync-jail: only rsync push allowed". Permits exactly:
#   1. an rsync --server push confined to the web root (the deploy), and
#   2. the post-deploy schema migration.
# Everything else is rejected.
#
# The rsync push is further constrained: an option allow-list (only --delete and
# --chmod=* may appear as long options) plus --munge-links (which neutralises any
# smuggled symlink so it can't resolve out of the jail) bound the receiver's
# blast radius. The exact server-side option bundle varies by rsync version, so
# before installing a change here run one real `./deploy.sh --dry-run` against the
# host to confirm the jail still accepts the deploy's server command.
set -euf # -f: no globbing, so word-splitting the server args below is safe

# The single web root this key may write to. Both allow-listed commands are
# anchored to it, so the migration path and the rsync destination confinement
# can't drift apart. Keep it in sync with deploy.sh's TARGET.
WEBROOT="html/comparebuilds.app"

cmd="${SSH_ORIGINAL_COMMAND:-}"

reject() {
	echo "rsync-jail: ${1:-only rsync push allowed}" >&2
	exit 1
}

case "$cmd" in
# 1. Schema migration — exact match, no client-supplied arguments to inject.
"php ${WEBROOT}/api/cron/ensure_schema.php")
	exec /usr/bin/php "${WEBROOT}/api/cron/ensure_schema.php"
	;;

# 2. rsync server (receiver) only — a push INTO this account. The `--sender`
#    flag marks a pull/read, so rejecting it keeps this push-only.
rsync\ --server\ --sender\ *)
	reject "pull not allowed"
	;;
rsync\ --server\ *)
	# Confine the write to the web root. rsync roots the receiver at the LAST
	# argument of the server command, and that argument is client-supplied — a
	# push-only jail that never checks it still lets a compromised key aim the
	# transfer at ~/.ssh/authorized_keys, ~/bin (this very script), or
	# ../config.php (the DB creds one level above the web root), or add --delete
	# to wipe files elsewhere. Reject any `..` traversal and any destination that
	# is not the web root (or a path beneath it) before handing off to rsync, so
	# the key's blast radius is exactly the tree it is meant to publish.
	dest=${cmd##* }
	case "$cmd" in
	*..*) reject "path traversal rejected" ;;
	esac
	case "$dest" in
	"${WEBROOT}" | "${WEBROOT}/"*) ;;
	*) reject "destination outside ${WEBROOT}" ;;
	esac

	# Allow-list the options rsync may pass. deploy.sh sends one short-flag bundle
	# plus the long option --delete (GNU rsync folds --dry-run into the short
	# bundle); refuse any other long option (--rsync-path, --files-from,
	# --remove-source-files, extra --delete-* modes, …) so a key holder can't
	# smuggle a dangerous receiver option past the destination check above. Short
	# bundles can't express those options, so they pass; . and the destination
	# carry no leading dash. --chmod=* is allow-listed for parity with the sibling
	# jail even though this deploy doesn't send it.
	# shellcheck disable=SC2086
	set -- ${cmd#rsync --server }
	for arg in "$@"; do
		case "$arg" in
		--delete | --chmod=*) : ;;
		--*) reject "option not allowed: $arg" ;;
		esac
	done

	# Neutralise symlinks: --munge-links prefixes any incoming symlink target so
	# it can never resolve outside the jail (a no-op for the symlink-free deploy
	# set). This closes the one escalation the checks above don't — a symlink
	# written into the web root that Apache would otherwise follow out of the jail.
	# shellcheck disable=SC2086
	exec rsync --server --munge-links ${cmd#rsync --server }
	;;

*)
	reject
	;;
esac
