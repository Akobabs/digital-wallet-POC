from django.db import models
from django.contrib.auth.models import User
from django.db.models.signals import post_save
from django.dispatch import receiver
import hashlib  # For basic encryption

class Profile(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE)
    balance = models.DecimalField(max_digits=10, decimal_places=2, default=1000.00)

    def __str__(self):
        return f"{self.user.username}'s Profile"

class Transaction(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    type = models.CharField(max_length=10, choices=[('credit', 'Credit'), ('debit', 'Debit')])
    timestamp = models.DateTimeField(auto_now_add=True)
    status = models.CharField(max_length=10, choices=[('pending', 'Pending'), ('completed', 'Completed')], default='completed')
    encrypted_data = models.TextField(blank=True)  # Store encrypted transaction data

    def encrypt_data(self):
        # Basic encryption of transaction data (for demo purposes)
        data = f"{self.user.id}:{self.amount}:{self.type}:{self.timestamp}"
        self.encrypted_data = hashlib.sha256(data.encode()).hexdigest()

    def save(self, *args, **kwargs):
        if not self.encrypted_data:
            self.encrypt_data()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.type} of {self.amount} by {self.user.username}"

@receiver(post_save, sender=User)
def create_user_profile(sender, instance, created, **kwargs):
    if created:
        Profile.objects.create(user=instance)

@receiver(post_save, sender=User)
def save_user_profile(sender, instance, **kwargs):
    instance.profile.save()