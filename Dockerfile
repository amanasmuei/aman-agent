FROM node:22-slim

RUN npm install -g @aman_asmuei/aman-agent@latest && \
    npm cache clean --force

ENV AMAN_HOME=/home/node/.aman-agent
USER node
WORKDIR /home/node

ENTRYPOINT ["aman-agent"]
