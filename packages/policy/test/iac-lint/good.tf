# Benign (E-022): nothing here should be found.
resource "aws_security_group" "web" {
  name = "web"
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
  }
}

resource "aws_s3_bucket_public_access_block" "assets" {
  bucket                  = aws_s3_bucket.assets.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_db_instance" "orders" {
  engine            = "postgres"
  instance_class    = "db.t3.medium"
  storage_encrypted = true
}

resource "azurerm_storage_account" "data" {
  name            = "data"
  min_tls_version = "TLS1_2"
}

resource "azurerm_monitor_diagnostic_setting" "data" {
  name               = "data-logs"
  target_resource_id = azurerm_storage_account.data.id
}

resource "aws_lb" "front" {
  name = "front"
  access_logs {
    bucket  = "logs"
    enabled = true
  }
}
