# Một môi trường duy nhất (nocode.ikame-solution.com) ⇒ một tag di động :prod.
# Vỏ mỏng gọi deploy/*.sh — KHÔNG lặp lại lệnh docker ở đây, vì script giữ những
# thứ `docker build` trần không có: --secret id=npmrc (@ikameglobal ở registry
# private), --build-arg VITE_* (build-time), tag :<git-sha> để rollback, và
# region ap-southeast-1 (repo ECR + host + S3 đều ở đây).
HOST ?= ec2-user@54.169.211.192

.PHONY: build deploy release

# Build amd64 + push ECR (chạy ở máy dev — Lightsail build vite là OOM).
build:
	./deploy/build-push.sh

# Blue-green trên host. .env pin :prod nên không phải sửa gì giữa các lần deploy.
deploy:
	ssh $(HOST) 'bash ~/project/no-code/deploy.sh'

release: build deploy
