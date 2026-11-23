# Seeded misconfigurations (E-022): each resource below has one.
resource "aws_security_group" "web" {
  name = "web"
  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_s3_bucket_public_access_block" "assets" {
  bucket              = aws_s3_bucket.assets.id
  block_public_acls   = false
  block_public_policy = true
}

resource "aws_db_instance" "orders" {
  engine         = "postgres"
  instance_class = "db.t3.medium"
  # storage_encrypted = true was taken out
}

resource "azurerm_storage_account" "data" {
  name                     = "data"
  min_tls_version          = "TLS1_0"
  account_replication_type = "LRS"
}

resource "aws_lb" "front" {
  name               = "front"
  load_balancer_type = "application"
}
