# OceanMCP 开发用 Makefile
# 使用: make dev   同时启动后端(4001)与前端(3001)，端口被占用会自动 kill

BACKEND_PORT  ?= 4001
FRONTEND_PORT ?= 3001

.PHONY: dev backend frontend kill kill-backend kill-frontend stop

## 同时启动前后端（先清理占用端口）
dev: kill
	@echo "🚀 启动后端(:$(BACKEND_PORT)) 与 前端(:$(FRONTEND_PORT))..."
	@trap 'kill 0' INT TERM; \
	(cd packages/api-server && bun run dev) & \
	(cd packages/frontend-sdk && bun run dev) & \
	wait

## 仅启动后端
backend: kill-backend
	@cd packages/api-server && bun run dev

## 仅启动前端
frontend: kill-frontend
	@cd packages/frontend-sdk && bun run dev

## 释放被占用的端口
kill: kill-backend kill-frontend

kill-backend:
	@pids=$$(lsof -ti tcp:$(BACKEND_PORT)); \
	if [ -n "$$pids" ]; then echo "🔪 释放后端端口 $(BACKEND_PORT) (pid: $$pids)"; kill -9 $$pids; fi

kill-frontend:
	@pids=$$(lsof -ti tcp:$(FRONTEND_PORT)); \
	if [ -n "$$pids" ]; then echo "🔪 释放前端端口 $(FRONTEND_PORT) (pid: $$pids)"; kill -9 $$pids; fi

## 停止前后端服务（等同 kill）
stop: kill
