FROM ghcr.io/imputnet/cobalt:11

USER root
COPY artifacts/cobalt/entrypoint.sh /usr/local/bin/hutaotik-cobalt-entrypoint
COPY artifacts/cobalt/write-keys.mjs /usr/local/bin/hutaotik-cobalt-write-keys.mjs
RUN chmod 0555 /usr/local/bin/hutaotik-cobalt-entrypoint /usr/local/bin/hutaotik-cobalt-write-keys.mjs

USER node
ENTRYPOINT ["/usr/local/bin/hutaotik-cobalt-entrypoint"]
CMD ["node", "src/cobalt"]
