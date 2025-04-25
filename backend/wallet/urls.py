from django.urls import path
from wallet_app import views

urlpatterns = [
    path('register/', views.register, name='register'),
    path('login/', views.user_login, name='login'),
    path('dashboard/<int:user_id>/', views.dashboard, name='dashboard'),
    path('generate-qr/<int:user_id>/', views.generate_qr, name='generate_qr'),
    path('pay/<int:user_id>/', views.pay, name='pay'),
    path('sync-transactions/<int:user_id>/', views.sync_transactions, name='sync_transactions'),
    path('profile/<int:user_id>/', views.user_profile, name='user_profile'),
]